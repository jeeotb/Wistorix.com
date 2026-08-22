#!/bin/bash
# Wistorix Blog Admin — mo dashboard quan ly bai viet (macOS)
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Chua cai Node.js. Tai tai https://nodejs.org roi chay lai file nay."
  echo ""
  read -n1 -r -p "Nhan phim bat ky de thoat..."
  exit 1
fi

# Neu blog-server dang chay san (vd. da bam start.command) thi chi mo trinh duyet
for P in 8899 8900 8901 8902 8903; do
  if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$P/blog-admin.html"; then
    echo "Blog Admin dang chay san o cong $P — dang mo trinh duyet..."
    open "http://localhost:$P/blog-admin.html"
    exit 0
  fi
done

echo "Dang mo Wistorix Blog Admin trong trinh duyet..."
( sleep 2; open "http://localhost:8899/blog-admin.html" ) &
node blog-server.js
