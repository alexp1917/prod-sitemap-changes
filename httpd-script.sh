#!/usr/bin/env bash

echo hi from httpd-script.sh

ab -n 20 -c 5 http://web:3000/sitemap.xml

sleep 10

ab -n 1000 -c 50 http://web:3000/sitemap.xml

sleep 10

ab -n 1000 -c 100 http://web:3000/sitemap.xml

tail -f /dev/null
