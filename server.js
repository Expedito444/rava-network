
const http = require("http");
const crypto = require("crypto");

const VERSION = "Experimental-7.2";
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
  return typeof address === "string" &&
    /^[a-f0-9]{40}$/.test(address);
}

function addressFromPublicKey(publicKey) {
  return crypto.createHash("sha256")
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

// Converte a assinatura ECDSA P-256 do formato Web Crypto
// (r || s, 64 bytes) para DER, usado pelo Node.js.
function rawEcdsaToDer(raw) {
  if (raw.length !== 64) {
    throw new Error("Tamanho de assinatura inválido.");
  }

  function encodeInteger(bytes) {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;

    let value = Buffer.from(bytes.subarray(i));

    if (value[0] & 0x80) {
      value = Buffer.concat([Buffer.from([0]), value]);
    }

    return Buffer.concat([
      Buffer.from([0x02, value.length]),
      value
    ]);
  }

  const r = encodeInteger(raw.subarray(0, 32));
  const s = encodeInteger(raw.subarray(32, 64));
  const body = Buffer.concat([r, s]);

  return Buffer.concat([
    Buffer.from([0x30, body.length]),
    body
  ]);
}

function verifyTransaction(tx) {
  try {
    if (!tx || tx.from === MINING_ADDRESS) return false;
    if (!validAddress(tx.from) || !validAddress(tx.to)) return false;
    if (tx.from === tx.to) return false;
    if (!Number.isSafeInteger(tx.amount) && !Number.isFinite(tx.amount)) {
      return false;
    }
    if (tx.amount <= 0 || !Number.isFinite(tx.amount)) return false;
    if (typeof tx.publicKey !== "string") return false;
    if (typeof tx.signature !== "string") return false;
    if (!/^[a-f0-9]+$/i.test(tx.signature)) return false;
    if (addressFromPublicKey(tx.publicKey) !== tx.from) return false;

    const signature = Buffer.from(tx.signature, "hex");
    const der = rawEcdsaToDer(signature);

    const verifier = crypto.createVerify("SHA256");
    verifier.update(transactionData(tx), "utf8");
    verifier.end();

    return verifier.verify(tx.publicKey, der);
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
    return crypto.createHash("sha256")
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

  getConfirmedBalance(address) {
    let balance = 0;

    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.to === address) balance += tx.amount;
        if (tx.from === address) balance -= tx.amount;
      }
    }

    return Number(balance.toFixed(8));
  }

  getAvailableBalance(address) {
    let balance = this.getConfirmedBalance(address);

    for (const tx of this.pendingTransactions) {
      if (tx.from === address) balance -= tx.amount;
    }

    return Number(balance.toFixed(8));
  }

  getTotalSupply() {
    let supply = 0;

    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.from === MINING_ADDRESS) supply += tx.amount;
      }
    }

    return Number(supply.toFixed(8));
  }

  addTransaction(tx) {
    if (!verifyTransaction(tx)) {
      throw new Error("Assinatura ou dados inválidos.");
    }

    if (this.getAvailableBalance(tx.from) < tx.amount) {
      throw new Error("Saldo disponível insuficiente.");
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
      throw new Error("Endereço de minerador inválido.");
    }

    const balances = new Map();

    const balanceOf = address => {
      if (!balances.has(address)) {
        balances.set(address, this.getConfirmedBalance(address));
      }
      return balances.get(address);
    };

    const included = [];

    for (const tx of this.pendingTransactions) {
      if (!verifyTransaction(tx)) continue;
      if (balanceOf(tx.from) < tx.amount) continue;

      balances.set(tx.from, balanceOf(tx.from) - tx.amount);
      balances.set(tx.to, balanceOf(tx.to) + tx.amount);
      included.push(tx);
    }

    const rewardTransaction = {
      from: MINING_ADDRESS,
      to: minerAddress,
      amount: this.reward
    };

    const block = new Block(
      this.chain.length,
      [...included, rewardTransaction],
      this.lastBlock.hash
    );

    block.mine(this.difficulty);
    this.chain.push(block);
    this.pendingTransactions = [];

    return {
      block,
      transacoesIncluidas: included.length
    };
  }

  isValid() {
    if (this.chain.length === 0) return false;

    const genesis = this.chain[0];

    if (
      genesis.index !== 0 ||
      genesis.previousHash !== "0" ||
      genesis.transactions.length !== 0 ||
      genesis.hash !== genesis.calculateHash()
    ) {
      return false;
    }

    const balances = new Map();

    const balanceOf = address => balances.get(address) || 0;

    const changeBalance = (address, amount) => {
      balances.set(
        address,
        Number((balanceOf(address) + amount).toFixed(8))
      );
    };

    for (let i = 1; i < this.chain.length; i++) {
      const block = this.chain[i];
      const previous = this.chain[i - 1];

      if (block.index !== i) return false;
      if (block.hash !== block.calculateHash()) return false;
      if (block.previousHash !== previous.hash) return false;
      if (!block.hash.startsWith("0".repeat(this.difficulty))) {
        return false;
      }

      if (!Array.isArray(block.transactions) ||
          block.transactions.length === 0) {
        return false;
      }

      const rewards = block.transactions.filter(
        tx => tx.from === MINING_ADDRESS
      );

      if (rewards.length !== 1) return false;

      const rewardTx = block.transactions[block.transactions.length - 1];

      if (rewardTx.from !== MINING_ADDRESS) return false;
      if (rewardTx.amount !== this.reward) return false;
      if (!validAddress(rewardTx.to)) return false;

      for (let j = 0; j < block.transactions.length - 1; j++) {
        const tx = block.transactions[j];

        if (!verifyTransaction(tx)) return false;
        if (balanceOf(tx.from) < tx.amount) return false;

        changeBalance(tx.from, -tx.amount);
        changeBalance(tx.to, tx.amount);
      }

      changeBalance(rewardTx.to, rewardTx.amount);
    }

    return true;
  }
}

const rava = new Blockchain();

const WALLET_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Carteira RAVA Experimental-7.2</title>
<style>
body{font-family:Arial,sans-serif;max-width:760px;margin:30px auto;padding:0 16px;background:#10151d;color:#f1f5f9}
.card{background:#1b2430;padding:18px;border-radius:12px;margin:16px 0}
input,textarea,button{box-sizing:border-box;width:100%;padding:12px;margin:7px 0;border-radius:7px;border:1px solid #465365;font:inherit}
input,textarea{background:#10151d;color:#f1f5f9}
button{background:#8de0b1;color:#102018;font-weight:bold;cursor:pointer}
small{color:#bac5d3;overflow-wrap:anywhere}
.notice{color:#ffd38a}
</style>
</head>
<body>
<h1>RAVA Network</h1>
<p>Carteira experimental — versão 7.2</p>
<div class="card">
<h2>1. Criar carteira local</h2>
<p>A chave privada é criada no navegador e não é enviada ao servidor.</p>
<button id="create">Gerar carteira de teste</button>
<p>Endereço</p><textarea id="address" rows="2" readonly></textarea>
<p>Chave pública</p><textarea id="pub" rows="4" readonly></textarea>
<p>Chave privada — guarde com cuidado</p>
<textarea id="priv" rows="5" readonly></textarea>
<p class="notice">Não compartilhe sua chave privada. Esta carteira é apenas para testes.</p>
</div>
<div class="card">
<h2>2. Saldo</h2>
<button id="balance">Consultar saldo</button>
<pre id="balanceResult"></pre>
</div>
<div class="card">
<h2>3. Enviar RVA</h2>
<label>Endereço de destino</label>
<input id="to" placeholder="Endereço público do destinatário">
<label>Valor</label>
<input id="amount" type="number" min="0.00000001" step="any" placeholder="0.5">
<button id="send">Assinar e enviar</button>
<pre id="sendResult"></pre>
</div>
<script>
let wallet = null;
const el = id => document.getElementById(id);
function hex(bytes) {
  return Array.from(new Uint8Array(bytes))
    .map(b => b.toString(16).padStart(2, "0")).join("");
}
function pem(label, bytes) {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  const b64 = btoa(binary);
  const lines = b64.match(/.{1,64}/g).join("\\n");
  return "-----BEGIN " + label + "-----\\n" +
    lines + "\\n-----END " + label + "-----\\n";
}
async function makeAddress(publicPem) {
  const digest = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(publicPem)
  );
  return hex(digest).slice(0, 40);
}
async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.erro || "Falha na requisição");
  return data;
}
el("create").onclick = async () => {
  try {
    wallet = await crypto.subtle.generateKey(
      {name:"ECDSA", namedCurve:"P-256"}, true, ["sign","verify"]
    );
    const pubBytes = await crypto.subtle.exportKey("spki", wallet.publicKey);
    const privBytes = await crypto.subtle.exportKey("pkcs8", wallet.privateKey);
    const publicKey = pem("PUBLIC KEY", pubBytes);
    const privateKey = pem("PRIVATE KEY", privBytes);
    const address = await makeAddress(publicKey);

    el("address").value = address;
    el("pub").value = publicKey;
    el("priv").value = privateKey;
    el("balanceResult").textContent = "Carteira criada.";
  } catch (e) {
    el("balanceResult").textContent = "Erro: " + e.message;
  }
};
el("balance").onclick = async () => {
  try {
    const address = el("address").value.trim();
    if (!address) throw new Error("Crie uma carteira primeiro.");
    const data = await request("/balance?address=" + encodeURIComponent(address));
    el("balanceResult").textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    el("balanceResult").textContent = e.message;
  }
};
el("send").onclick = async () => {
  try {
    if (!wallet) throw new Error("Gere a carteira nesta página antes de enviar.");
    const from = el("address").value.trim();
    const to = el("to").value.trim();
    const amount = Number(el("amount").value);

    if (!/^[a-f0-9]{40}$/.test(to)) {
      throw new Error("Endereço de destino inválido.");
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Informe um valor maior que zero.");
    }

    const tx = {from: from, to: to, amount: amount};
    const bytes = new TextEncoder().encode(JSON.stringify(tx));
    const signature = await crypto.subtle.sign(
      {name:"ECDSA", hash:"SHA-256"}, wallet.privateKey, bytes
    );

    const data = await request("/transaction", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        from: from,
        to: to,
        amount: amount,
        publicKey: el("pub").value,
        signature: hex(signature)
      })
    });

    el("sendResult").textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    el("sendResult").textContent = "Erro: " + e.message;
  }
};
</script>
</body>
</html>`;

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
        aviso: "Rede educacional; dados não persistentes."
      });
    }

    if (url.pathname === "/wallet" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      return res.end(WALLET_HTML);
    }

    if (url.pathname === "/balance" && req.method === "GET") {
      const address = url.searchParams.get("address");

      if (!validAddress(address)) {
        return sendJson(res, 400, {
          erro: "Informe ?address=SEU_ENDERECO válido."
        });
      }

      return sendJson(res, 200, {
        versao: VERSION,
        address,
        saldoConfirmado: rava.getConfirmedBalance(address),
        saldoDisponivel: rava.getAvailableBalance(address),
        moedasEmCirculacao: rava.getTotalSupply()
      });
    }

    if (url.pathname === "/transaction" && req.method === "POST") {
      let body = "";

      for await (const chunk of req) {
        body += chunk;
        if (body.length > 20000) {
          return sendJson(res, 413, {erro: "Requisição muito grande."});
        }
      }

      const input = JSON.parse(body || "{}");
      const {from, to, amount, publicKey, signature} = input;

      if (!validAddress(from) || !validAddress(to)) {
        return sendJson(res, 400, {erro: "Endereço inválido."});
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return sendJson(res, 400, {erro: "Valor inválido."});
      }

      const tx = {from, to, amount, publicKey, signature};
      const pendentes = rava.addTransaction(tx);

      return sendJson(res, 201, {
        versao: VERSION,
        acao: "transação assinada localmente e adicionada à fila",
        transacao: tx,
        assinaturaValida: verifyTransaction(tx),
        transacoesPendentes: pendentes
      });
    }

    if (url.pathname === "/transaction" && req.method === "GET") {
      return sendJson(res, 405, {
        erro: "Use a carteira em /wallet para assinar e enviar transações."
      });
    }

    if (url.pathname === "/mine" && req.method === "GET") {
      const minerAddress = url.searchParams.get("miner");

      if (!validAddress(minerAddress)) {
        return sendJson(res, 400, {
          erro: "Informe ?miner=SEU_ENDERECO válido."
        });
      }

      const result = rava.minePendingTransactions(minerAddress);

      return sendJson(res, 200, {
        versao: VERSION,
        acao: "bloco minerado",
        recompensa: rava.reward,
        transacoesIncluidas: result.transacoesIncluidas,
        bloco: result.block,
        saldoDoMinerador: rava.getConfirmedBalance(minerAddress),
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
      rotas: ["/", "/wallet", "/balance", "/transaction",
              "/mine", "/validate", "/chain"]
    });
  } catch (error) {
    return sendJson(res, 400, {
      erro: error.message || "Erro ao processar a requisição."
    });
  }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(VERSION + " da RAVA Network rodando na porta " + PORT);
});
