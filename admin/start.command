#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Chua cai Node.js. Hay cai tai https://nodejs.org roi chay lai."
  read -n1 -r -p "Nhan phim bat ky de thoat..."
  exit 1
fi
# Blog admin chay nen (cong 8899) de nut "Blog SEO" trong editor mo duoc ngay.
node blog-server.js &
BLOG_PID=$!
trap 'kill $BLOG_PID 2>/dev/null' EXIT INT TERM
( sleep 2; open "http://localhost:8787/editor.html" ) &
node server.js
