FROM alpine:3.20

RUN apk add --no-cache dcron tini curl

WORKDIR /app
COPY refresh.sh /app/refresh.sh
RUN chmod +x /app/refresh.sh

COPY crontab /etc/crontabs/root

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["crond", "-f", "-l", "2"]
