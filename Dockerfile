FROM node:16.14.0-alpine3.15

RUN apk update
RUN apk upgrade

WORKDIR /app

COPY package.json package.json

RUN npm i

COPY . .

ENV NODE_ENV='production'


CMD [ "node", "app.js" ]