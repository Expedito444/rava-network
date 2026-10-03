const http = require("http");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;

// ===============================
// RAVA BLOCKCHAIN - EXPERIMENTAL 2
// ===============================

class Block {
  constructor(index, timestamp, data, previousHash = "") {
    this.index = index;
    this.timestamp = timestamp;
    this.data = data;
    this.previousHash = previousHash;
    this.hash = this.calculateHash();
  }

  calculateHash() {
    return crypto
      .createHash("sha256")
      .update(
        this.index +
        this.timestamp +
        JSON.stringify(this.data) +
        this.previousHash
      )
      .digest("hex");
  }
}

class Blockchain {
  constructor() {
    this.chain = [this.createGenesisBlock()];
  }

  createGenesisBlock() {
    return new Block(
      0,
      new Date().toISOString(),
      {
        mensagem: "Bloco Genesis da RAVA"
      },
      "0"
    );
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }
}

const ravaBlockchain = new Blockchain();

// ===============================
// SERVIDOR
// ===============================

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(
    JSON.stringify(
      {
        projeto: "RAVA Blockchain Network",
        versao: "Experimental-2",
        status: "online",
        blockchain: ravaBlockchain.chain
      },
      null,
      2
    )
  );
});

server.listen(PORT, () => {
  console.log(`RAVA Blockchain rodando na porta ${PORT}`);
});
