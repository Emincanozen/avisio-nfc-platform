#!/usr/bin/env bash
#
# Recherche de secrets dans les fichiers suivis et dans l'historique Git.
#
# Un `.gitignore` ne protège que l'avenir : un secret déjà committé y reste,
# accessible à quiconque clone le dépôt, même après suppression du fichier.
# C'est pour cela que ce script fouille aussi l'historique.
#
# Il attrape les formes reconnaissables (clés API à préfixe connu, blocs de
# clé privée, chaînes de connexion avec mot de passe). Il n'attrape pas un
# secret qui ressemble à du texte ordinaire : ce n'est pas un filet, c'est un
# garde-fou contre la faute d'inattention la plus fréquente.
#
#   bash scripts/check-secrets.sh

set -uo pipefail

# `grep -P` refuse de fonctionner hors locale unibyte ou UTF-8 : il écrit
# « -P supports only unibyte and UTF-8 locales » et rend la main en échec.
# Les appels ci-dessous avalent les erreurs, donc ce refus se lirait « aucun
# secret » — la panne la plus dangereuse pour un contrôle de sécurité.
export LC_ALL=${LC_ALL:-C.UTF-8}

trouve=0

signaler() {
  echo "SECRET POSSIBLE — $1"
  echo "$2" | head -5
  echo ""
  trouve=1
}

# --- Motifs -----------------------------------------------------------------
#
# Chacun cible un préfixe que seul un vrai secret porte. Les motifs vagues
# (« password= ») produiraient trop de faux positifs pour être lus, et un
# contrôle qu'on ne lit plus ne sert à rien.

# Mots de passe manifestement fictifs, tolérés dans une URL de base.
#
# Un vrai mot de passe n'est jamais littéralement « motdepasse ». Les jeux
# d'essai en ont besoin — le contrôle de configuration se teste avec une URL
# complète — et les signaler use l'attention sur du bruit, jusqu'à ce que
# plus personne ne lise la sortie.
#
# La liste est fermée et exige le mot de passe *entier* : « motdepasse2024 »
# reste signalé. Le risque résiduel assumé est qu'un jour une vraie base
# porte l'un de ces mots comme mot de passe — auquel cas le problème n'est
# pas qu'on ne l'ait pas détecté ici.
FICTIFS='motdepasse|password|changeme|secret|exemple|example|xxxxxx+'

declare -A MOTIFS=(
  ["clé API Anthropic"]='sk-ant-[A-Za-z0-9_-]{20,}'
  ["clé API OpenAI"]='sk-[A-Za-z0-9]{32,}'
  ["clé API Resend"]='re_[A-Za-z0-9_-]{20,}'
  ["jeton Google OAuth"]='1//[A-Za-z0-9_-]{30,}'
  ["secret client Google"]='GOCSPX-[A-Za-z0-9_-]{20,}'
  ["clé AWS"]='AKIA[0-9A-Z]{16}'
  ["jeton GitHub"]='gh[pousr]_[A-Za-z0-9]{30,}'
  ["clé privée PEM"]='-----BEGIN [A-Z ]*PRIVATE KEY-----'
  ["URL de base avec mot de passe"]='postgres(ql)?://[^:/@[:space:]]+:(?!('"$FICTIFS"')@)[^@[:space:]]{6,}@(?!localhost|127\.0\.0\.1)'
)

# --- Le contrôle se contrôle lui-même ---------------------------------------
#
# Chaque recherche plus bas finit par `2>/dev/null || true` : une erreur de
# grep devient un résultat vide, donc « aucun secret ». Un scanner muet passe
# au vert en ne cherchant rien, et fabrique une confiance qu'il ne mérite pas.
#
# On lui soumet donc un appât dont on connaît la réponse. S'il ne le voit
# pas, le moteur est cassé et le reste de la sortie ne veut rien dire.
appat='postgresql://avisio:Xk9mQ2vT7pL@db.exemple.net:5432/prod'
if ! echo "$appat" | grep -qP "${MOTIFS["URL de base avec mot de passe"]}" 2>/dev/null; then
  echo "ÉCHEC : grep -P ne détecte pas l'appât de contrôle." >&2
  echo "Le moteur d'expressions régulières est indisponible ou mal configuré." >&2
  echo "Ce script ne peut rien garantir dans cet état : on s'arrête ici." >&2
  exit 2
fi

echo "1. Fichiers suivis"
for nom in "${!MOTIFS[@]}"; do
  # `.env.example` est exclu : il contient des noms de variables, pas des
  # valeurs, et c'est précisément le fichier qui doit être committé.
  resultat=$(git grep -nIP "${MOTIFS[$nom]}" -- ':!.env.example' ':!scripts/check-secrets.sh' 2>/dev/null || true)
  [ -n "$resultat" ] && signaler "$nom (fichier suivi)" "$resultat"
done
[ "$trouve" -eq 0 ] && echo "   aucun"

echo ""
echo "2. Fichiers qui ne devraient jamais être suivis"
interdits=$(git ls-files | grep -E '(^|/)\.env$|(^|/)\.env\.(local|production|prod)$|\.pem$|\.p12$|\.pfx$|id_rsa|\.sqlite$|\.db$' || true)
if [ -n "$interdits" ]; then
  signaler "fichier sensible suivi par Git" "$interdits"
else
  echo "   aucun"
fi

echo ""
echo "3. Historique Git"
# `git log -p` sur tout l'historique : un secret retiré depuis reste ici.
historique=$(git log -p --all --no-color 2>/dev/null || true)
for nom in "${!MOTIFS[@]}"; do
  resultat=$(echo "$historique" | grep -nP "${MOTIFS[$nom]}" 2>/dev/null | grep -v 'check-secrets' || true)
  [ -n "$resultat" ] && signaler "$nom (historique)" "$resultat"
done
[ "$trouve" -eq 0 ] && echo "   aucun"

echo ""
if [ "$trouve" -ne 0 ]; then
  cat <<'FIN'
============================================================
Un secret possible a été trouvé.

Si c'en est un :
  1. Le RÉVOQUER d'abord, chez le fournisseur. C'est la seule action qui
     compte : tant qu'il est valide, il est compromis, et le retirer du
     dépôt ne le rend pas inutilisable.
  2. En émettre un nouveau, et le placer en variable d'environnement.
  3. Seulement ensuite, nettoyer l'historique (git filter-repo). Réécrire
     un historique déjà partagé casse les copies des autres : à ne faire
     qu'en connaissance de cause.

Si c'est un faux positif, affiner le motif dans ce script plutôt que de
désactiver le contrôle.
============================================================
FIN
  exit 1
fi

echo "Aucun secret détecté."
