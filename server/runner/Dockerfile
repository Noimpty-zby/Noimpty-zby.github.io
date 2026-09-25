FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d \
    && chmod +x /usr/sbin/policy-rc.d \
    && apt-get update \
    && apt-get install -y --no-install-recommends gcc g++ golang-go git bash coreutils findutils tar gzip python3 mysql-server mysql-client ca-certificates \
    && rm -rf /var/lib/apt/lists/* /var/lib/mysql/*
RUN groupadd --gid 10001 learner && useradd --uid 10001 --gid 10001 --home-dir /work learner
COPY check-limits.py cleanup.py start-mysql.py restore-mysql.py /opt/nanaly/
USER 10001:10001
WORKDIR /work
CMD ["sleep", "150"]
