# Shared PostgreSQL pilot/test recipe. Official base retained by immutable digest;
# upgrade actual vulnerable libraries and REMOVE the unused root-switch helper.
FROM docker.io/library/postgres:18-alpine@sha256:0115267ab5a509022df9319c77be365cef335adb71556c75f60f5360ee247e71
RUN apk add --no-cache --upgrade krb5-libs=1.22.3-r0 libxslt=1.1.43-r4 \
    && rm -f /usr/local/bin/gosu
# PostgreSQL must never rely on a root entrypoint or gosu in this recipe.
USER 70:70
