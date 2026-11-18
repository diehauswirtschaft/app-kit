# Shared PostgreSQL pilot/test recipe. Official base retained by immutable digest;
# upgrade actual vulnerable libraries and REMOVE the unused root-switch helper.
FROM docker.io/library/postgres:17-alpine@sha256:3540c0362c809df084ffac0ae69fe794515f9de92692f02178bcdce0ef0302ac
RUN apk add --no-cache --upgrade krb5-libs=1.22.3-r0 libxslt=1.1.43-r4 \
    && rm -f /usr/local/bin/gosu
# PostgreSQL must never rely on a root entrypoint or gosu in this recipe.
USER 70:70
