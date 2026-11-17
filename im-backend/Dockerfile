FROM node:12-alpine
RUN apk update \
    && apk add --upgrade apk-tools \
    && apk upgrade --available \
    && npm install -g npm
WORKDIR /ankous
ADD package.json .
RUN npm install
ADD . .
EXPOSE 3000
CMD ["npm", "run", "local"]
