FROM node:16.3-alpine3.12

workdir /app
copy ./ /app

run yarn install --frozen-lockfile

expose 3000

cmd yarn start
