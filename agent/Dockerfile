FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

# Ferramentas necessárias para o Worker Agent
RUN apt-get update && apt-get install -y \
    git \
    git-lfs \
    curl \
    wget \
    unzip \
    zip \
    tar \
    gzip \
    bzip2 \
    xz-utils \
    ca-certificates \
    openssh-client \
    jq \
    tree \
    nano \
    vim \
    build-essential \
    python3 \
    python3-pip \
    python3-venv \
    python-is-python3 \
    php-cli \
    php-curl \
    php-mbstring \
    php-xml \
    php-zip \
    php-intl \
    php-gd \
    composer \
    && rm -rf /var/lib/apt/lists/*

# Configura o Git para aceitar qualquer diretório no workspace sem erro de permissão
RUN git config --system --add safe.directory '*'

# Prepara a estrutura da aplicação e do workspace com as permissões corretas
WORKDIR /app
RUN mkdir -p /workspace && chown -R node:node /app /workspace

# Copia arquivos do pacote ajustando o dono para o usuário não-root
COPY --chown=node:node package*.json ./

# Alterna para o usuário não-root para instalar dependências e rodar a aplicação
USER node

RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node src ./src

# Define o diretório de trabalho onde o agente vai operar
WORKDIR /workspace

ENTRYPOINT ["node", "/app/src/index.js"]
