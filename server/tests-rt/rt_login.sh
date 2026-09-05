#!/bin/bash
# REDTEAM PoC helper — fetch tokens for all demo roles. Throttle to respect login rate limit (20/min).
API=http://127.0.0.1:8080
for u in principal teacher finance transport facilities technician coordinator admissions owner itadmin parent; do
  email="${u}@meridian.edu"
  resp=$(curl -s -m 5 -X POST $API/auth/login -H 'content-type: application/json' -d "{\"email\":\"$email\",\"password\":\"schoolos-demo\"}")
  tok=$(echo "$resp" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token??'')}catch{console.log('')}})")
  echo "export TOK_${u^^}='$tok'"
  sleep 3.2
done
