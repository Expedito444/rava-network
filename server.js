
const http = require("http");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const DIFFICULTY = 4;

// ========================================
// RAVA BLOCKCHAIN - EXPERIMENTAL 6
// CARTEIRAS E ASSINATURAS DIGITAIS
// ========================================

function createWallet() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "secp256k1",
    publicKeyEncoding: {
      type: "spki",
      format: "pem"
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem"
    }
  });

  const address = crypto
    .createHash("sha256")
    .update(publicKey)
    .digest("hex")
    .slice(0, 40);

  return { address, publicKey, privateKey };
}

function transactionMessage(from, to, amount) {
  return JSON.stringify({ from, to, amount });
}

function signTransaction(wallet, to, amount) {
  const from = wallet.address;
  const message = transactionMessage(from, to, amount);

  const signature = crypto.sign(
    "SHA256",
    Buffer.from(message),
    wallet.privateKey
  ).toString("hex");

  return {
    from,
    to,
    amount,
    publicKey: wallet.publicKey,
    signature
  };
}

function verifyTransaction(tx) {
  try {
    if (
      !tx ||
      typeof tx.from !== "string" ||
      typeof tx.to !== "string" ||
      tx.from === tx.to ||
      !Number.isFinite(tx.amount) ||
      tx.amount <= 0 ||
      typeof tx.publicKey !== "string" ||
      typeof tx.signature !== "string"
    ) {
      return false;
    }

    const derivedAddress = crypto
      .createHash("sha256")
      .update(tx.publicKey)
      .digest("hex")
      .slice(0, 40);

    if (derivedAddress !== tx.from) return false;

    const message = transactionMessage(
      tx.from,
      tx.to,
      tx.amount
    );

    return crypto.verify(
      "SHA256",
      Buffer.from(message),
      tx.publicKey,
      Buffer.from(tx.signature, "hex")
    );
  } catch {
    return false;
  }
}

class Block {
  constructor(index, timestamp, transactions, previousHash = "") {
    this.index = index;
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.previousHash = previousHash;
    this.nonce = 0;
    this.hash = this.mineBlock();
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

  mineBlock() {
    const target = "0".repeat(DIFFICULTY);

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
    this.wallets = new Map();
  }

  createGenesisBlock() {
    return new Block(
      0,
      new Date().toISOString(),
      [{ mensagem: "Bloco Genesis da RAVA" }],
      "0"
    );
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  createWallet() {
    const wallet = createWallet();
    this.wallets.set(wallet.address, wallet);
    return wallet;
  }

  addTransaction(tx) {
    if (!verifyTransaction(tx)) {
      throw new Error("Assinatura inválida ou transação incorreta.");
    }

    this.pendingTransactions.push(tx);
    return tx;
  }

  minePendingTransactions() {
    if (this.pendingTransactions.length === 0) {
      return null;
    }

    const transactions = this.pendingTransactions.slice();

    const block = new Block(
      this.chain.length,
      new Date().toISOString(),
      transactions,
      this.getLatestBlock().hash
    );

    this.chain.push(block);
    this.pendingTransactions = [];

    return block;
  }
}

const ravaBlockchain = new Blockchain();

// Carteira de demonstração criada na inicialização.
// A chave privada NÃO será exibida na API.
const demoWallet = ravaBlockchain.createWallet();
const demoRecipient = ravaBlockchain.createWallet();

// ========================================
// SERVIDOR HTTP
// ========================================

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const url = new URL(req.url, "http://localhost");

  function respond(status, data) {
    res.writeHead(status);
    res.end(JSON.stringify(data, null, 2));
  }

  // Estado da blockchain
  if (url.pathname === "/" && req.method === "GET") {
    return respond(200, {
      projeto: "RAVA Blockchain Network",
      versao: "Experimental-6",
      status: "online",
      dificuldade: DIFFICULTY,
      quantidadeDeBlocos: ravaBlockchain.chain.length,
      transacoesPendentes: ravaBlockchain.pendingTransactions.length,
      blockchain: ravaBlockchain.chain
    });
  }

  // Criar uma carteira de demonstração
  if (url.pathname === "/wallet" && req.method === "GET") {
    const wallet = ravaBlockchain.createWallet();

    return respond(200, {
      versao: "Experimental-6",
      acao: "carteira criada",
      address: wallet.address,
      publicKey: wallet.publicKey,
      mensagem: "A chave privada não é exibida nem guardada após esta resposta."
    });
  }

  // Criar e assinar uma transação de demonstração
  if (url.pathname === "/transaction" && req.method === "GET") {
    const tx = signTransaction(
      demoWallet,
      demoRecipient.address,
      10
    );

    try {
      ravaBlockchain.addTransaction(tx);

      return respond(200, {
        versao: "Experimental-6",
        acao: "transação assinada e adicionada",
        transacao: tx,
        assinaturaValida: verifyTransaction(tx),
        transacoesPendentes: ravaBlockchain.pendingTransactions.length
      });
    } catch (error) {
      return respond(400, { erro: error.message });
    }
  }

  // Minerar transações pendentes
  if (url.pathname === "/mine" && req.method === "GET") {
    const block = ravaBlockchain.minePendingTransactions();

    if (!block) {
      return respond(400, {
        versao: "Experimental-6",
        erro: "Não há transações pendentes para minerar."
      });
    }

    return respond(200, {
      versao: "Experimental-6",
      acao: "bloco minerado",
      dificuldade: DIFFICULTY,
      bloco: block
    });
  }

  return respond(404, {
    erro: "Rota não encontrada",
    rotas: ["/", "/wallet", "/transaction", "/mine"]
  });
});

server.listen(PORT, () => {
  console.log(`RAVA Experimental-6 rodando na porta ${PORT}`);
});
