FROM denoland/deno:2

WORKDIR /app

COPY deno.json deno.lock ./
RUN deno install

COPY *.ts ./

CMD ["task", "start"]
