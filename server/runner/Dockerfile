FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d \
    && chmod +x /usr/sbin/policy-rc.d \
    && apt-get update \
    && apt-get install -y --no-install-recommends gcc g++ golang-go git bash coreutils findutils tar gzip python3 python3-venv \
        ncal grep sed gawk less tree file zip unzip xz-utils bzip2 jq bc diffutils patch procps util-linux \
        curl wget openssh-client mysql-server mysql-client ca-certificates \
    && rm -rf /var/lib/apt/lists/* /var/lib/mysql/*
RUN git config --system user.name Learner \
    && git config --system user.email learner@example.invalid \
    && git config --system init.defaultBranch main
# Python practice: CPU-only PyTorch and NumPy in a venv. Containers have no network, so
# everything learners can import must be installed here.
RUN python3 -m venv /opt/py \
    && /opt/py/bin/pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch \
    && /opt/py/bin/pip install --no-cache-dir numpy
# Warm Go build cache; the runner copies it into the writable /tmp/go-cache before compiling.
COPY go-warm.go /opt/nanaly/
RUN GOCACHE=/opt/go-cache CGO_ENABLED=0 GOTOOLCHAIN=local GOPROXY=off go build -o /dev/null /opt/nanaly/go-warm.go \
    && chmod -R a+rX /opt/go-cache
ENV PATH=/opt/py/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1
RUN groupadd --gid 10001 learner && useradd --uid 10001 --gid 10001 --home-dir /work learner
# Interactive terminal for Linux and Git. Its own layer, so the PyTorch layer above stays cached.
# The base image is "minimized" without manuals: undo that so `man` works, then reinstall the
# packages lessons use to put their manuals back. HOME is the Git workspace itself, so the
# dotfiles that less, vim and python leave there are ignored instead of showing as untracked.
RUN rm -f /etc/dpkg/dpkg.cfg.d/excludes \
    && if [ "$(dpkg-divert --truename /usr/bin/man)" = /usr/bin/man.REAL ]; then rm -f /usr/bin/man && dpkg-divert --quiet --remove --rename /usr/bin/man; fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends nano vim bash-completion man-db manpages manpages-dev tzdata \
        make tmux htop psmisc lsof strace \
    && apt-get install -y --no-install-recommends --reinstall coreutils findutils grep sed gawk tar gzip bzip2 xz-utils zip unzip \
        bash procps util-linux diffutils patch ncal less file tree jq bc git git-man curl wget openssh-client passwd hostname gcc-13 g++-13 cpp-13 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && echo Asia/Shanghai > /etc/timezone \
    && printf '%s\n' .lesshst .viminfo .python_history .wget-hsts > /etc/gitignore-practice \
    && git config --system core.excludesFile /etc/gitignore-practice \
    && mandb -q
COPY code sudo /usr/local/bin/
ENV TZ=Asia/Shanghai
COPY check-limits.py cleanup.py start-mysql.py restore-mysql.py shell-session.py py-check.py /opt/nanaly/
USER 10001:10001
WORKDIR /work
CMD ["sleep", "150"]
