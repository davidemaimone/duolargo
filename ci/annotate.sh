#!/bin/bash
# Uso: ci/annotate.sh <livello> <titolo> <file>
# Emette il contenuto del file come un'unica annotazione multilinea di GitHub Actions,
# leggibile anche via API (check-runs/annotations).
level="$1"; title="$2"; file="$3"
[ -s "$file" ] || exit 0
body=$(head -c 60000 "$file" | sed -e 's/%/%25/g' -e 's/\r/%0D/g' | awk 'BEGIN{ORS="%0A"} {print}')
echo "::${level} title=${title}::${body}"
