/**
 * POS Terminal Driver
 * Supporta:
 *  - PAX D230 (Nexi/SumUp) via POSLINK TCP/IP (porta default 10009)
 *  - myPOS Go 2 — semi-integrazione: mostra importo, conferma manuale
 *
 * PAX POSLINK frame format:
 *   [STX=0x02] [LEN_LO] [LEN_HI] [PAYLOAD] [ETX=0x03] [LRC]
 *   LRC = XOR(LEN_LO, LEN_HI, ...PAYLOAD_BYTES, ETX)
 *
 * A30 Sale request PAYLOAD:
 *   "1A30" + FS + AmountCents + FS + Tip + FS + CashBack + FS + MerchantId +
 *   FS + RefNum + FS + ZipCode + FS + UniqueDeviceId + FS + RequestMode + FS + TxId + FS + Reserved
 *
 * A30 Sale response PAYLOAD (after upload-flag byte stripped):
 *   "A30" + FS + Status(000000=OK) + FS + RespCode(00=Approv) + FS + RespMsg
 *         + FS + HostCode + FS + TraceNum + FS + EDCType + FS + LookupNum
 *         + FS + ApprovalCode + FS + EntryMode + FS + Amount + FS + AmountDue
 *         + FS + TipAmount + FS + CashBackAmount + FS + MerchantId + FS + RefNum
 *         + FS + CardType + FS + PANLast4 + FS + PANMasked + FS + DateTime + FS + TxId + FS + Reserved
 */

import * as net from "net";

const STX = 0x02;
const ETX = 0x03;
const FS  = 0x1C; // Field Separator

export interface PosTerminalResult {
  approved: boolean;
  authCode?: string;
  last4?: string;
  cardType?: string;
  responseMessage?: string;
  error?: string;
}

// ─── PAX POSLINK ──────────────────────────────────────────────────────────────

function buildPaxSaleFrame(amountCents: number, reference: string): Buffer {
  const fields = [
    String(amountCents),   // Amount in cents (no decimals)
    "0",                   // TipAmount
    "0",                   // CashBackAmount
    "",                    // MerchantId
    reference.substring(0, 16), // ReferenceNum (max 16)
    "",                    // ZipCode
    "",                    // UniqueDeviceId
    "",                    // RequestMode
    "",                    // TransactionId
    "",                    // Reserved
  ];

  const fsChar = String.fromCharCode(FS);
  const payloadStr = "1A30" + fsChar + fields.join(fsChar);
  const payload = Buffer.from(payloadStr, "ascii");

  const lenLo = payload.length & 0xff;
  const lenHi = (payload.length >> 8) & 0xff;

  let lrc = lenLo ^ lenHi;
  for (const b of payload) lrc ^= b;
  lrc ^= ETX;

  return Buffer.concat([
    Buffer.from([STX, lenLo, lenHi]),
    payload,
    Buffer.from([ETX, lrc]),
  ]);
}

function parsePaxResponse(buf: Buffer): PosTerminalResult {
  const stxIdx = buf.indexOf(STX);
  if (stxIdx === -1) throw new Error("Risposta PAX non valida: no STX");

  const etxIdx = buf.indexOf(ETX, stxIdx + 3);
  if (etxIdx === -1) throw new Error("Risposta PAX incompleta: no ETX");

  // payload = bytes tra STX+3 e ETX
  const payload = buf.slice(stxIdx + 3, etxIdx).toString("ascii");

  // Rimuovi upload flag (primo carattere, di solito "0")
  const data = payload.slice(1);

  // Dividi per FS
  const parts = data.split(String.fromCharCode(FS));

  // parts[0]  = "A30" (comando)
  // parts[1]  = Status ("000000" = transazione elaborata)
  // parts[2]  = ResponseCode ("00" = approvata)
  // parts[3]  = ResponseMessage (es. "APPROVED")
  // parts[4]  = HostCode
  // parts[5]  = TraceNum
  // parts[6]  = EDCType
  // parts[7]  = LookupNum
  // parts[8]  = ApprovalCode
  // parts[9]  = EntryMode
  // parts[10] = Amount
  // parts[11] = AmountDue
  // parts[12] = TipAmount
  // parts[13] = CashBackAmount
  // parts[14] = MerchantId
  // parts[15] = ReferenceNum
  // parts[16] = CardType
  // parts[17] = PANLast4
  // parts[18] = PANMasked
  // parts[19] = DateTimeResponse
  // parts[20] = TransactionId
  // parts[21] = Reserved

  const status      = parts[1]  ?? "";  // "000000" = OK
  const responseCode= parts[2]  ?? "";  // "00" = approvata
  const responseMsg = parts[3]  ?? "";
  const approvalCode= parts[8]  ?? "";
  const cardType    = parts[16] ?? "";
  const last4       = parts[17] ?? "";

  console.log(`[PAX] status=${status} code=${responseCode} msg=${responseMsg} auth=${approvalCode} last4=${last4}`);

  if (status === "000000" && responseCode === "00") {
    return { approved: true, authCode: approvalCode, last4, cardType, responseMessage: responseMsg };
  }

  return {
    approved: false,
    responseMessage: responseMsg || `Status ${status} / Code ${responseCode}`,
    error: responseMsg || `Transazione rifiutata (${responseCode})`,
  };
}

export async function payViaPax(
  ip: string,
  port: number,
  amountCents: number,
  reference: string,
  timeoutMs = 120_000
): Promise<PosTerminalResult> {
  return new Promise((resolve) => {
    const client = new net.Socket();
    let recvBuf = Buffer.alloc(0);
    let resolved = false;

    const done = (result: PosTerminalResult) => {
      if (resolved) return;
      resolved = true;
      client.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => {
      done({ approved: false, error: "Timeout: nessuna risposta dal terminale PAX in 120s" });
    }, timeoutMs);

    client.setTimeout(timeoutMs);

    client.connect(port, ip, () => {
      console.log(`[PAX] Connesso ${ip}:${port} — invio A30 importo=${amountCents}¢ ref=${reference}`);
      const frame = buildPaxSaleFrame(amountCents, reference);
      client.write(frame);
    });

    client.on("data", (chunk: Buffer) => {
      recvBuf = Buffer.concat([recvBuf, chunk]);
      // Frame completo quando troviamo ETX dopo almeno 5 byte di header
      const etxIdx = recvBuf.indexOf(ETX, 4);
      if (etxIdx === -1) return;
      clearTimeout(timer);
      try {
        done(parsePaxResponse(recvBuf));
      } catch (e) {
        done({ approved: false, error: e instanceof Error ? e.message : String(e) });
      }
    });

    client.on("error", (err) => {
      clearTimeout(timer);
      done({ approved: false, error: `Connessione PAX fallita: ${err.message}` });
    });

    client.on("timeout", () => {
      clearTimeout(timer);
      done({ approved: false, error: "Timeout socket PAX" });
    });
  });
}

export async function pingPax(ip: string, port: number): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const client = new net.Socket();
    const timer = setTimeout(() => {
      client.destroy();
      resolve({ ok: false, error: "Timeout connessione PAX" });
    }, 5000);

    client.connect(port, ip, () => {
      clearTimeout(timer);
      client.destroy();
      resolve({ ok: true });
    });

    client.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
  });
}

// ─── myPOS Go 2 ───────────────────────────────────────────────────────────────
// myPOS Go 2 è un terminale standalone. Non espone un API TCP locale.
// L'integrazione è "semi-automatica": il backend restituisce immediatamente
// un { approved: false, manualConfirmRequired: true } e il frontend mostra
// l'importo invitando il cassiere a confermare manualmente dopo che il
// terminale approva.
// Se in futuro myPOS espone un API locale, basta implementarla qui.

export interface MyPosSaleResult extends PosTerminalResult {
  manualConfirmRequired?: boolean;
}

export async function initiateMyPos(
  amountCents: number,
  reference: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _apiKey: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _terminalId: string,
): Promise<MyPosSaleResult> {
  // La richiesta viene loggata, il frontend mostra l'importo e attende conferma manuale
  console.log(`[MYPOS] Richiesta pagamento manuale: importo=${amountCents}¢ ref=${reference}`);
  return {
    approved: false,
    manualConfirmRequired: true,
    responseMessage: `Inserisci €${(amountCents / 100).toFixed(2)} sul terminale myPOS, poi conferma qui`,
  };
}
