
const http = require("http");
const crypto = require("crypto");

const VERSION = "Experimental-7";
const DIFFICULTY = 4;
const BLOCK_REWARD = 1;
const MINING_ADDRESS = "RAVA_MINING_REWARD";

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data, null, 2));
}

function validAddress(address) {
  return typeof address === "string" && /^[a-f0-9]{40}$/i.test(address);
}

function addressFromPublicKey(publicKey) {
  return crypto
    .createHash("sha256")
    .update(publicKey)
    .digest("hex")
    .slice(0, 40);
}

function transactionData(tx) {
  return JSON.stringify({
    from: tx.from,
    to: tx.to,
    amount: tx.amount
  });
}

function createWallet() {
  const pair = crypto.generateKeyPairSync("ec", {
    namedCurve: "secp256k1"
  });

  const privateKey = pair.privateKey.export({
    type: "pkcs8",
    format: "pem"
  });

  const publicKey = pair.publicKey.export({
    type: "spki",
    format: "pem"
  });

  return {
    address: addressFromPublicKey(publicKey),
    publicKey,
    privateKey
  };
}

function verifyTransaction(tx) {
  try {
    if (!tx || tx.from === MINING_ADDRESS) return false;
    if (!validAddress(tx.from) || !validAddress(tx.to)) return false;
    if (!Number.isFinite(tx.amount) || tx.amount <= 0) return false;
    if (typeof tx.publicKey !== "string" || !tx.signature) return false;
    if (addressFromPublicKey(tx.publicKey) !== tx.from) return false;

    const verifier = crypto.createVerify("SHA256");
    verifier.update(transactionData(tx));
    verifier.end();

    return verifier.verify(
      tx.publicKey,
      Buffer.from(tx.signature, "hex")
    );
  } catch {
    return false;
  }
}

class Block {
  constructor(index, transactions, previousHash) {
    this.index = index;
    this.timestamp = new Date().toISOString();
    this.transactions = transactions;
    this.previousHash = previousHash;
    this.nonce = 0;
    this.hash = this.calculateHash();
  }

  calculateHash() {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify({
        index: this.index,
        timestamp: this.timestamp,
        transactions: this.transactions,
        previousHash: this.previousHash,
        nonce: this.nonce
      }))
      .digest("hex");
  }

  mine(difficulty) {
    const target = "0".repeat(difficulty);

    while (!this.hash.startsWith(target)) {
      this.nonce++;
      this.hash = this.calculateHash();
    }
  }
}

class Blockchain {
  constructor() {
    this.chain = [];
    this.pendingTransactions = [];
    this.reward = BLOCK_REWARD;
    this.difficulty = DIFFICULTY;

    this.chain.push(new Block(0, [], "0"));
  }

  get lastBlock() {
    return this.chain[this.chain.length - 1];
  }

  getBalance(address, includePending = true) {
    let balance = 0;

    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.to === address) balance += tx.amount;
        if (tx.from === address) balance -= tx.amount;
      }
    }

    if (includePending) {
      for (const tx of this.pendingTransactions) {
        if (tx.from === address) balance -= tx.amount;
      }
    }

    return Number(balance.toFixed(8));
  }

  getTotalSupply() {
    let supply = 0;

    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.from === MINING_ADDRESS) {
          supply += tx.amount;
        }
      }
    }

    return Number(supply.toFixed(8));
  }

  addTransaction(tx) {
    if (!verifyTransaction(tx)) {
      throw new Error("Assinatura ou dados da transação inválidos.");
    }

    if (tx.from === tx.to) {
      throw new Error("Origem e destino devem ser diferentes.");
    }

    if (this.getBalance(tx.from) < tx.amount) {
      throw new Error("Saldo insuficiente para essa transferência.");
    }

    this.pendingTransactions.push({
      from: tx.from,
      to: tx.to,
      amount: tx.amount,
      publicKey: tx.publicKey,
      signature: tx.signature
    });

    return this.pendingTransactions.length;
  }

  minePendingTransactions(minerAddress) {
    if (!validAddress(minerAddress)) {
      throw new Error("Informe um endereço válido para minerar.");
    }

    const rewardTransaction = {
      from: MINING_ADDRESS,
      to: minerAddress,
      amount: this.reward
    };

    const transactions = [
      ...this.pendingTransactions,
      rewardTransaction
    ];

    const block = new Block(
      this.chain.length,
      transactions,
      this.lastBlock.hash
    );

    block.mine(this.difficulty);
    this.chain.push(block);
    this.pendingTransactions = [];

    return block;
  }

  isValid() {
    for (let i = 1; i < this.chain.length; i++) {
      const current = this.chain[i];
      const previous = this.chain[i - 1];

      if (current.hash !== current.calculateHash()) return false;
      if (current.previousHash !== previous.hash) return false;

      if (!current.hash.startsWith("0".repeat(this.difficulty))) {
        return false;
      }

      const rewards = current.transactions.filter(
        tx => tx.from === MINING_ADDRESS
      );

      if (rewards.length !== 1) return false;
      if (rewards[0].amount !== this.reward) return false;
      if (!validAddress(rewards[0].to)) return false;

      for (const tx of current.transactions) {
        if (tx.from !== MINING_ADDRESS && !verifyTransaction(tx)) {
          return false;
        }
      }
    }

    return true;
  }
}

const rava = new Blockchain();

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }

  const url = new URL(req.url, "http://localhost");

  try {
    if (url.pathname === "/" && req.method === "GET") {
      return sendJson(res, 200, {
        projeto: "RAVA Network",
        versao: VERSION,
        status: "online",
        blocos: rava.chain.length,
        dificuldade: rava.difficulty,
        recompensaPorBloco: rava.reward,
        moedasEmCirculacao: rava.getTotalSupply(),
        transacoesPendentes: rava.pendingTransactions.length,
        aviso: "Rede experimental; os dados não são persistentes."
      });
    }

    if (url.pathname === "/wallet" && req.method === "GET") {
      const wallet = createWallet();

      return sendJson(res, 200, {
        versao: VERSION,
        acao: "carteira de teste criada",
        address: wallet.address,
        publicKey: wallet.publicKey,
        privateKey: wallet.privateKey,
        aviso: "TESTE APENAS. Nunca use esta chave com dinheiro real."
      });
    }

    if (url.pathname === "/balance" && req.method === "GET") {
      const address = url.searchParams.get("address");

      if (!validAddress(address)) {
        return sendJson(res, 400, {
          erro: "Informe um endereço válido usando ?address=SEU_ENDERECO"
        });
      }

      return sendJson(res, 200, {
        versao: VERSION,
        address,
        saldoDisponivel: rava.getBalance(address),
        moedasEmCirculacao: rava.getTotalSupply()
      });
    }

    if (url.pathname === "/transaction" && req.method === "POST") {
      let body = "";

      for await (const chunk of req) {
        body += chunk;

        if (body.length > 20000) {
          return sendJson(res, 413, {
            erro: "Requisição muito grande."
          });
        }
      }

      const input = JSON.parse(body || "{}");
      const { from, to, amount, publicKey, privateKey } = input;

      if (!validAddress(from) || !validAddress(to)) {
        return sendJson(res, 400, {
          erro: "Os endereços de origem e destino devem ser válidos."
        });
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        return sendJson(res, 400, {
          erro: "O valor deve ser maior que zero."
        });
      }

      if (typeof publicKey !== "string" ||
          typeof privateKey !== "string") {
        return sendJson(res, 400, {
          erro: "Envie as chaves da carteira de teste."
        });
      }

      const derivedPublicKey = crypto.createPublicKey(privateKey).export({
        type: "spki",
        format: "pem"
      });

      if (derivedPublicKey !== publicKey ||
          addressFromPublicKey(publicKey) !== from) {
        return sendJson(res, 400, {
          erro: "As chaves não correspondem ao endereço de origem."
        });
      }

      const tx = { from, to, amount };
      const signer = crypto.createSign("SHA256");
      signer.update(transactionData(tx));
      signer.end();

      tx.publicKey = publicKey;
      tx.signature = signer.sign(privateKey, "hex");

      const pendentes = rava.addTransaction(tx);

      return sendJson(res, 201, {
        versao: VERSION,
        acao: "transação assinada e adicionada à fila",
        transacao: tx,
        assinaturaValida: verifyTransaction(tx),
        transacoesPendentes: pendentes
      });
    }

    if (url.pathname === "/transaction" && req.method === "GET") {
      return sendJson(res, 405, {
        erro: "Use POST com JSON para enviar uma transação.",
        exemplo: {
          from: "endereco_de_origem",
          to: "endereco_de_destino",
          amount: 0.5,
          publicKey: "chave_publica",
          privateKey: "chave_privada_de_teste"
        }
      });
    }

    if (url.pathname === "/mine" && req.method === "GET") {
      const minerAddress = url.searchParams.get("miner");

      if (!minerAddress) {
        return sendJson(res, 400, {
          erro: "Informe sua carteira usando ?miner=SEU_ENDERECO"
        });
      }

      const block = rava.minePendingTransactions(minerAddress);

      return sendJson(res, 200, {
        versao: VERSION,
        acao: "bloco minerado",
        recompensa: rava.reward,
        bloco: block,
        saldoDoMinerador: rava.getBalance(minerAddress),
        moedasEmCirculacao: rava.getTotalSupply()
      });
    }

    if (url.pathname === "/validate" && req.method === "GET") {
      return sendJson(res, 200, {
        versao: VERSION,
        blockchainValida: rava.isValid(),
        blocos: rava.chain.length
      });
    }

    if (url.pathname === "/chain" && req.method === "GET") {
      return sendJson(res, 200, {
        versao: VERSION,
        chain: rava.chain,
        transacoesPendentes: rava.pendingTransactions
      });
    }

    return sendJson(res, 404, {
      erro: "Rota não encontrada.",
      rotas: [
        "/",
        "/wallet",
        "/balance",
        "/transaction",
        "/mine",
        "/validate",
        "/chain"
      ]
    });
  } catch (error) {
    return sendJson(res, 400, {
      erro: error.message || "Erro ao processar a requisição."
    });
  }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`${VERSION} da RAVA Network rodando na porta ${PORT}`);
});
