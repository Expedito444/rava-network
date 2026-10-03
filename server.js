const http = require("http");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;

// ========================================
// RAVA BLOCKCHAIN - EXPERIMENTAL 4
// PROOF OF WORK
// ========================================

class Block {
  constructor(index, timestamp, data, previousHash = "") {
    this.index = index;
    this.timestamp = timestamp;
    this.data = data;
    this.previousHash = previousHash;
    this.nonce = 0;
    this.hash = this.mineBlock(4);
  }

  calculateHash() {
    return crypto
      .createHash("sha256")
      .update(
        this.index +
        this.timestamp +
        JSON.stringify(this.data) +
        this.previousHash +
        this.nonce
      )
      .digest("hex");
  }

  mineBlock(difficulty) {
    const target = "0".repeat(difficulty);

    while (this.hash === undefined || !this.hash.startsWith(target)) {
      this.nonce++;
      this.hash = this.calculateHash();
    }

    return this.hash;
  }
}

class Blockchain {
  constructor() {
    this.chain = [this.createGenesisBlock()];
  }

  createGenesisBlock() {
    const block = new Block(
      0,
      new Date().toISOString(),
      {
        mensagem: "Bloco Genesis da RAVA"
      },
      "0"
    );

    return block;
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  addBlock(data) {
    const previousBlock = this.getLatestBlock();

    const newBlock = new Block(
      this.chain.length,
      new Date().toISOString(),
      data,
      previousBlock.hash
    );

    this.chain.push(newBlock);

    return newBlock;
  }
}

const ravaBlockchain = new Blockchain();

// ========================================
// SERVIDOR
// ========================================

const server = http.createServer((req, res) => {

  // ========================================
  // MINERAÇÃO
  // ========================================

  if (req.url === "/mine" && req.method === "GET") {

    const newBlock = ravaBlockchain.addBlock({
      mensagem: "Bloco minerado na RAVA"
    });

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });

    res.end(
      JSON.stringify(
        {
          projeto: "RAVA Blockchain Network",
          versao: "Experimental-4",
          acao: "bloco minerado",
          dificuldade: 4,
          bloco: newBlock
        },
        null,
        2
      )
    );

    return;
  }

  // ========================================
  // VISUALIZAR BLOCKCHAIN
  // ========================================

  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  });

  res.end(
    JSON.stringify(
      {
        projeto: "RAVA Blockchain Network",
        versao: "Experimental-4",
        status: "online",
        dificuldade: 4,
        quantidadeDeBlocos: ravaBlockchain.chain.length,
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
