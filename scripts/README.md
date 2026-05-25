# Helper scripts

Small command-line utilities that aren't part of the running platform — for one-off setup, deployments, and maintenance.

## `push-to-github.sh` — first off-machine backup of the code

Right now your only copy of the source history is on this Mac. A private GitHub repo gives you a free, off-site backup and unlocks `git push` after each commit.

### One-time setup

1. **Create a GitHub account** at <https://github.com/> if you don't have one.

2. **Set up SSH keys** (only needed once per machine):
   ```bash
   ssh-keygen -t ed25519 -C "academie@ubuntu3.local"
   # Press Enter to accept defaults; pick a passphrase or leave blank.
   pbcopy < ~/.ssh/id_ed25519.pub
   ```
   Paste the key at <https://github.com/settings/keys> ("New SSH key", title "Mac"). Then verify:
   ```bash
   ssh -T git@github.com
   # Expect: "Hi <your-username>! You've successfully authenticated…"
   ```

3. **Create an empty private repo** at <https://github.com/new>. Pick a name — `ubuntu3` is fine. **Do not** initialise it with a README, .gitignore, or licence (we have those locally). Click Create. On the next page, copy the SSH URL — looks like `git@github.com:<your-username>/ubuntu3.git`.

4. **Run the helper:**
   ```bash
   cd "/Users/jniyonkuru/Documents/Claude/Projects/Ubuntu 3.0 Platform"
   bash scripts/push-to-github.sh git@github.com:<your-username>/ubuntu3.git
   ```
   It wires the remote, pushes `main`, `develop`, and the `v0.3.6` tag. Done.

### Daily life after that

```bash
git push          # push current branch
git push --tags   # push any new release tags
```

If a new collaborator joins, they `git clone git@github.com:<your-username>/ubuntu3.git` and they're set up — they only need to copy `server/config.local.example.php` to `server/config.php` and run `docker compose up -d`.

### Adding the GitHub repo as a backup-only mirror

If you'd rather not push every commit but want a periodic mirror, set up a cron job on your Mac:

```bash
# Once a day at midnight, push every branch + tag to GitHub
0 0 * * *  cd "/Users/jniyonkuru/Documents/Claude/Projects/Ubuntu 3.0 Platform" && git push --all && git push --tags
```

### What if the Mac dies before you push?

If the laptop dies before you set this up, everything since the last rsync to the droplet is lost. **Do it now**, not later. Five minutes of work.

### Other backup options

- **Self-hosted bare repo on the droplet.** `git init --bare /opt/ubuntu3-git.git` on the droplet, then `git remote add origin ubuntu@165.232.85.152:/opt/ubuntu3-git.git`. Free, but the droplet becomes a single point of failure for both prod and source.
- **External drive snapshot.** Copy the entire project folder (including `.git`) to a Time Machine target or USB stick periodically. Manual, but no third-party dependency.

GitHub is the right answer for ~99% of cases. The other two are fallbacks.
