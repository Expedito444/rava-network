const http = require("http");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });

  res.end(JSON.stringify({
    projeto: "RAVA Blockchain Network",
    versao: "Experimental-1",
    status: "online"
  }));
});

server.listen(PORT, () => {
  console.log(`RAVA Blockchain rodando na porta ${PORT}`);
});
