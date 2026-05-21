<?php
declare(strict_types=1);

namespace Ubuntu;

/**
 * Photo / audio bytes for a story.
 *
 * Storage on disk under <server>/storage/stories/<story_id>-<kind>.<ext>
 * (outside the public document root). Metadata in story_media.
 */
final class Media
{
    private const MAX_BYTES = 10 * 1024 * 1024;   // 10 MB
    private const ALLOWED = [
        'photo' => ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/heic' => 'heic'],
        'audio' => ['audio/webm' => 'webm', 'audio/ogg' => 'ogg', 'audio/mpeg' => 'mp3', 'audio/mp4' => 'm4a', 'audio/wav' => 'wav', 'audio/x-m4a' => 'm4a'],
    ];

    private static function storageDir(): string
    {
        $dir = dirname(__DIR__) . '/storage/stories';
        if (!is_dir($dir)) {
            if (!@mkdir($dir, 0775, true) && !is_dir($dir)) {
                Response::error('server_misconfigured', 'Storage directory cannot be created. Check permissions on server/storage.', 500);
            }
        }
        return $dir;
    }

    /** POST /api/stories/{id}/media/{kind}  (multipart, file field "file"). */
    public static function upload(string $storyId, string $kind): void
    {
        $user = Auth::requireUser();
        if (!isset(self::ALLOWED[$kind])) Response::error('bad_request', 'Unknown media kind.', 400);

        // Validate story
        $pdo = Db::pdo();
        $stmt = $pdo->prepare('SELECT id FROM stories WHERE id = ? AND (deleted_at IS NULL) LIMIT 1');
        $stmt->execute([$storyId]);
        if (!$stmt->fetch()) Response::error('not_found', 'Story not found.', 404);

        // File from multipart, or raw body fallback
        $tmpPath = null;
        $mime    = null;
        $size    = 0;
        if (!empty($_FILES['file']) && is_uploaded_file($_FILES['file']['tmp_name'])) {
            if ($_FILES['file']['error'] !== UPLOAD_ERR_OK) {
                Response::error('upload_failed', 'Upload error code ' . $_FILES['file']['error'], 400);
            }
            $tmpPath = $_FILES['file']['tmp_name'];
            $mime    = (string) ($_FILES['file']['type'] ?? '');
            $size    = (int) ($_FILES['file']['size'] ?? 0);
        } else {
            // Raw body fallback (curl --data-binary)
            $raw = file_get_contents('php://input');
            if ($raw === false || $raw === '') Response::error('bad_request', 'No file in body.', 400);
            $size = strlen($raw);
            $mime = $_SERVER['HTTP_CONTENT_TYPE'] ?? ($_SERVER['CONTENT_TYPE'] ?? '');
            $tmpPath = tempnam(sys_get_temp_dir(), 'ubuntu30');
            file_put_contents($tmpPath, $raw);
        }

        if ($size <= 0) Response::error('bad_request', 'Empty upload.', 400);
        if ($size > self::MAX_BYTES) Response::error('too_large', 'File exceeds 10 MB.', 413);

        // Sniff mime if we don't trust the header
        if (function_exists('finfo_open')) {
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            $sniff = finfo_file($finfo, $tmpPath);
            finfo_close($finfo);
            if ($sniff) $mime = $sniff;
        }
        $allowed = self::ALLOWED[$kind];
        if (!isset($allowed[$mime])) {
            Response::error('unsupported_media', 'Mime type not allowed: ' . $mime, 415);
        }
        $ext = $allowed[$mime];

        $dir  = self::storageDir();
        $path = $dir . '/' . $storyId . '-' . $kind . '.' . $ext;
        if (is_file($path)) @unlink($path);
        if (!@rename($tmpPath, $path)) {
            // Cross-device rename fails; copy
            if (!@copy($tmpPath, $path)) {
                Response::error('write_failed', 'Could not write file to storage.', 500);
            }
            @unlink($tmpPath);
        }
        @chmod($path, 0644);

        $sha = hash_file('sha256', $path) ?: '';
        $rel = 'stories/' . basename($path);
        $now = Db::nowUtc();

        // Remove previous record of this kind for this story, insert new one
        $pdo->prepare('DELETE FROM story_media WHERE story_id = ? AND kind = ?')->execute([$storyId, $kind]);
        $pdo->prepare(
            'INSERT INTO story_media (id, story_id, kind, mime, size_bytes, sha256, storage_path, uploaded_at) VALUES (?,?,?,?,?,?,?,?)'
        )->execute([Util::uuid(), $storyId, $kind, $mime, $size, $sha, $rel, $now]);

        // Flip the boolean on the story (and bump server_updated_at so other clients re-pull)
        $flag = ($kind === 'photo') ? 'has_photo' : 'has_audio';
        $pdo->prepare("UPDATE stories SET {$flag} = 1, server_updated_at = ?, author_id = COALESCE(author_id, ?) WHERE id = ?")
            ->execute([$now, $user['id'], $storyId]);

        Response::ok([
            'mime' => $mime,
            'size' => $size,
            'sha256' => $sha,
            'storyId' => $storyId,
            'kind' => $kind,
        ]);
    }

    /** GET /api/stories/{id}/media/{kind} */
    public static function download(string $storyId, string $kind): void
    {
        Auth::requireUser();
        if (!isset(self::ALLOWED[$kind])) Response::error('bad_request', 'Unknown media kind.', 400);
        $pdo = Db::pdo();
        $stmt = $pdo->prepare('SELECT mime, size_bytes, storage_path FROM story_media WHERE story_id = ? AND kind = ? LIMIT 1');
        $stmt->execute([$storyId, $kind]);
        $row = $stmt->fetch();
        if (!$row) {
            self::clearOrphanFlag($storyId, $kind);
            Response::error('not_found', 'Media not found.', 404);
        }
        $abs = dirname(__DIR__) . '/storage/' . $row['storage_path'];
        if (!is_file($abs)) {
            // story_media row exists but the file is gone — clean both.
            $pdo->prepare('DELETE FROM story_media WHERE story_id = ? AND kind = ?')
                ->execute([$storyId, $kind]);
            self::clearOrphanFlag($storyId, $kind);
            Response::error('not_found', 'File missing.', 404);
        }
        header('Content-Type: ' . $row['mime']);
        header('Content-Length: ' . $row['size_bytes']);
        header('Cache-Control: private, max-age=86400');
        readfile($abs);
        exit;
    }

    /**
     * Self-heal: a story claimed has_photo/has_audio=1 but no actual file exists.
     * Clear the flag and bump server_updated_at so other clients learn the truth
     * on their next sync and stop asking.
     */
    private static function clearOrphanFlag(string $storyId, string $kind): void
    {
        $col = ($kind === 'photo') ? 'has_photo' : 'has_audio';
        Db::pdo()->prepare(
            "UPDATE stories SET {$col} = 0, server_updated_at = ?
             WHERE id = ? AND {$col} = 1"
        )->execute([Db::nowUtc(), $storyId]);
    }

    /** DELETE /api/stories/{id}/media/{kind} */
    public static function delete(string $storyId, string $kind): void
    {
        Auth::requireUser();
        if (!isset(self::ALLOWED[$kind])) Response::error('bad_request', 'Unknown media kind.', 400);
        $pdo = Db::pdo();
        $stmt = $pdo->prepare('SELECT storage_path FROM story_media WHERE story_id = ? AND kind = ?');
        $stmt->execute([$storyId, $kind]);
        $row = $stmt->fetch();
        if ($row) {
            $abs = dirname(__DIR__) . '/storage/' . $row['storage_path'];
            if (is_file($abs)) @unlink($abs);
            $pdo->prepare('DELETE FROM story_media WHERE story_id = ? AND kind = ?')->execute([$storyId, $kind]);
            $flag = ($kind === 'photo') ? 'has_photo' : 'has_audio';
            $pdo->prepare("UPDATE stories SET {$flag} = 0, server_updated_at = ? WHERE id = ?")
                ->execute([Db::nowUtc(), $storyId]);
        }
        Response::ok();
    }
}
