# Filename: Dockerfile
FROM node:12-alpine
RUN apk update \
    && apk add --upgrade apk-tools \
    && apk upgrade --available \
    && npm install -g npm
ARG buildENV
# if you don't pass buildENV then kmart-internal is run
ENV runtimeENV=${buildENV:-kmart-internal}
WORKDIR /kmart-integration
COPY . .
RUN npm install
EXPOSE 8080
CMD npm run $runtimeENV
