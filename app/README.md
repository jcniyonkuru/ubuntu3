# Ubuntu 3.0 — M&E (v0.1)

Une application web installable (PWA) pour le suivi des cohortes, sessions, présences et récits de l'Académie Ubuntu. Fonctionne **hors ligne**. Les données restent sur l'appareil tant que la synchronisation serveur n'est pas activée (prévue en v0.2).

## Contenu du dossier

```
app/
├── index.html              ← Coque de l'application
├── app.css                 ← Styles
├── app.js                  ← Logique et écrans
├── db.js                   ← Couche IndexedDB (stockage local)
├── service-worker.js       ← Cache hors ligne
├── manifest.webmanifest    ← Métadonnées d'installation
├── icon.svg                ← Icône vectorielle
├── icon-192.png            ← Icône PWA 192×192
├── icon-512.png            ← Icône PWA 512×512
└── README.md               ← Ce fichier
```

## Tester en local (sur votre ordinateur)

Le service worker (qui rend l'app installable et utilisable hors ligne) ne fonctionne qu'en **HTTPS** ou via **localhost**. Pour un test rapide :

### Avec Python (fourni partout)
Dans un terminal, depuis ce dossier :

```bash
python3 -m http.server 8080
```

Puis ouvrez `http://localhost:8080/` dans Chrome ou Safari.

### Avec Node.js
```bash
npx serve -p 8080
```

## Tester sur un téléphone Android

1. Déployez l'app sur n'importe quelle URL **HTTPS** (cf. section suivante).
2. Sur le téléphone, ouvrez l'URL dans **Chrome**.
3. Menu (⋮) → **« Ajouter à l'écran d'accueil »**.
4. L'icône apparaît sur l'écran d'accueil. L'app se lance en plein écran, hors ligne incluse.

## Tester sur iPad / iPhone

1. Ouvrez l'URL **HTTPS** dans **Safari**.
2. Bouton **Partager** → **« Sur l'écran d'accueil »**.

> Note iOS : l'enregistrement audio direct (MediaRecorder) n'est pas toujours disponible sur Safari iOS selon la version. Le bouton « Fichier audio » sert de solution de secours.

## Déploiement sur votre droplet DigitalOcean (à côté de Moodle)

C'est un simple ensemble de fichiers statiques. Sur la VM Moodle :

```bash
# 1. Créer un dossier
sudo mkdir -p /var/www/ubuntu3
sudo chown -R $USER:$USER /var/www/ubuntu3

# 2. Copier les fichiers du dossier app/ ici (via scp, rsync, ou git)

# 3. Vhost Apache (exemple : me.academyubuntu.com)
sudo tee /etc/apache2/sites-available/ubuntu3.conf > /dev/null <<'EOF'
<VirtualHost *:80>
  ServerName me.academyubuntu.com
  DocumentRoot /var/www/ubuntu3
  <Directory /var/www/ubuntu3>
    Options -Indexes +FollowSymLinks
    AllowOverride None
    Require all granted
  </Directory>
  AddType application/manifest+json .webmanifest
</VirtualHost>
EOF
sudo a2ensite ubuntu3
sudo systemctl reload apache2

# 4. HTTPS (Let's Encrypt)
sudo certbot --apache -d me.academyubuntu.com
```

Pointez un enregistrement DNS A `me.academyubuntu.com` vers l'IP de la droplet avant d'exécuter `certbot`.

## Données

Toutes les données sont conservées dans **IndexedDB** sur l'appareil :

| Magasin       | Contenu                                                 |
|---------------|---------------------------------------------------------|
| `cohorts`     | Cohortes (nom, région, dates)                           |
| `groups`      | Groupes (liés à une cohorte)                            |
| `participants`| Participants (liés à un groupe)                         |
| `sessions`    | Sessions (date, thème, lieu, notes, groupe)             |
| `attendance`  | Présences (session × participant, booléen)              |
| `stories`     | Récits (texte, photo, audio, consentement)              |
| `meta`        | Profil de l'utilisateur de l'appareil                   |

Chaque enregistrement contient : `id` (UUID), `createdAt`, `updatedAt`, `authorId`, `dirty`. Le flag `dirty` sert pour la synchronisation à venir.

## Export

Depuis l'onglet **Plus → Exporter** :

- Un CSV par magasin (compatible Excel, Google Sheets).
- Une **sauvegarde JSON complète** (incluant photos et audio en base64) — utile en attendant le serveur.

## Limites connues de la v0.1

- Un seul utilisateur par appareil (pas de multi-comptes locaux).
- Pas de serveur — l'export CSV ou JSON est le seul moyen de partager les données.
- Pas d'import — la sauvegarde JSON est lisible, mais le re-chargement viendra en v0.2.

## À venir

- **v0.2** : backend PHP/MySQL sur la même droplet, synchronisation, rôles, emails Brevo.
- **v0.3** : SSO Moodle (OAuth2), suivi de la posture des assistants-formateurs.
- **v0.4** : LTI vers les cours Moodle, certifications, rapports automatisés pour les bailleurs.
