const http = require("http");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;

// ========================================
// RAVA BLOCKCHAIN - EXPERIMENTAL 5
// TRANSAÇÕES + MEMPOOL + PROOF OF WORK
// ========================================

class Transaction {
  constructor(from, to, amount) {
    this.from = from;
    this.to = to;
    this.amount = amount;
  }
}

class Block {
  constructor(index, timestamp, transactions, previousHash = "") {
    this.index = index;
    this.timestamp = timestamp;
    this.transactions = transactions;
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
        JSON.stringify(this.transactions) +
        this.previousHash +
        this.nonce
      )
      .digest("hex");
  }

  mineBlock(difficulty) {
    const target = "0".repeat(difficulty);

    do {
      this.nonce++;
      this.hash = this.calculateHash();
    } while (!this.hash.startsWith(target));

    return this.hash;
  }
}

class Blockchain {
  constructor() {
    this.chain = [this.createGenesisBlock()];
    this.pendingTransactions = [];
  }

  createGenesisBlock() {
    return new Block(
      0,
      new Date().toISOString(),
      [
        new Transaction(
          "SISTEMA",
          "RAVA_NETWORK",
          0
        )
      ],
      "0"
    );
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  addTransaction(transaction) {
    this.pendingTransactions.push(transaction);

    return transaction;
  }

  minePendingTransactions() {
    const block = new Block(
      this.chain.length,
      new Date().toISOString(),
      this.pendingTransactions,
      this.getLatestBlock().hash
    );

    this.chain.push(block);

    this.pendingTransactions = [];

    return block;
  }
}

const ravaBlockchain = new Blockchain();

// ========================================
// SERVIDOR
// ========================================

const server = http.createServer((req, res) => {

  // ========================================
  // CRIAR TRANSAÇÃO DE TESTE
  // ========================================

  if (req.url === "/transaction" && req.method === "GET") {

    const transaction = new Transaction(
      "RAVA_WALLET_A",
      "RAVA_WALLET_B",
      10
    );

    ravaBlockchain.addTransaction(transaction);

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });

    res.end(
      JSON.stringify(
        {
          projeto: "RAVA Blockchain Network",
          versao: "Experimental-5",
          acao: "transação adicionada",
          transacao: transaction,
          transacoesPendentes:
            ravaBlockchain.pendingTransactions.length
        },
        null,
        2
      )
    );

    return;
  }

  // ========================================
  // MINERAR TRANSAÇÕES
  // ========================================

  if (req.url === "/mine" && req.method === "GET") {

    const newBlock =
      ravaBlockchain.minePendingTransactions();

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });

    res.end(
      JSON.stringify(
        {
          projeto: "RAVA Blockchain Network",
          versao: "Experimental-5",
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
        versao: "Experimental-5",
        status: "online",
        dificuldade: 4,
        quantidadeDeBlocos:
          ravaBlockchain.chain.length,
        transacoesPendentes:
          ravaBlockchain.pendingTransactions.length,
        blockchain: ravaBlockchain.chain
      },
      null,
      2
    )
  );
});

server.listen(PORT, () => {
  console.log(
    `RAVA Blockchain rodando na porta ${PORT}`
  );
});
