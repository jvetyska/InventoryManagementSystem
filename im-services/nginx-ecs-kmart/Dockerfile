FROM nginx:alpine

RUN adduser -u 82 -D -S -G www-data www-data

COPY ./default.conf /etc/nginx/conf.d/default.conf

COPY ./nginx.conf /etc/nginx/nginx.conf

COPY ./mime.types /etc/nginx/mime.types

COPY ./dhparam.pem /etc/nginx/dhparam.pem

COPY ./backend-not-found.html /var/www/html/backend-not-found.html

COPY ./snippets/ /etc/nginx/snippets/

COPY ./html/index.nginx-debian.html /var/www/html/index.html

RUN ln -sf /dev/stdout /var/log/nginx/default-access.log && ln -sf /dev/stdout /var/log/nginx/default-error.log
