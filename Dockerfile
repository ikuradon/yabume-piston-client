FROM denoland/deno:latest

WORKDIR /app

COPY deno.json deno.lock ./
RUN deno install

COPY *.ts ./

CMD ["task", "start"]
