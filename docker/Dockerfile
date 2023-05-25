FROM node:13.13.0

RUN mkdir -p /app/ftp

# install node modules at front for caching
RUN mkdir -p /app/packages/server
RUN mkdir -p /app/packages/web
COPY ./packages/server/package.json /app/packages/server
COPY ./packages/server/package-lock.json /app/packages/server
COPY ./packages/web/package.json /app/packages/web
COPY ./packages/web/package-lock.json /app/packages/web
WORKDIR /app/packages/server
RUN npm install
WORKDIR /app/packages/web
RUN npm install

WORKDIR /app

# skip cache for following steps
ADD "http://worldtimeapi.org/api/ip" skipcache
RUN git clone https://github.com/PotatsoX/proj-gulag.git
RUN cp -r /app/proj-gulag/* /app/

# build web files
WORKDIR /app/packages/web
RUN npm run build

# build and start the server
WORKDIR /app/packages/server
RUN npm run build

# Environment vars & credentials
COPY ./docker/.env /app/packages/server/.env

# CoAP port
EXPOSE 5683
# TCP port
EXPOSE 5678
# Web & API port
EXPOSE 80

CMD npm run prod