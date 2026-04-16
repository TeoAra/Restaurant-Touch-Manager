export interface FatturaPAData {
  cedente: {
    denominazione: string;
    partitaIva: string;
    codiceFiscale?: string;
    indirizzo: string;
    cap: string;
    comune: string;
    provincia: string;
    nazione: string;
    regimeFiscale: string;
  };
  cessionario: {
    tipo: string;
    ragioneSociale?: string;
    nome?: string;
    cognome?: string;
    codiceFiscale?: string;
    partitaIva?: string;
    codiceDestinatario: string;
    pec?: string;
    indirizzo?: string;
    cap?: string;
    comune?: string;
    provincia?: string;
    nazione: string;
  };
  documento: {
    numero: string;
    data: string;
    tipoDocumento: string;
    aliquotaIva: string;
    imponibile: string;
    iva: string;
    totale: string;
    righe: Array<{ descrizione: string; quantita: string; prezzoUnitario: string; importo: string; aliquotaIva: string }>;
    metodoPagamento?: string;
    note?: string;
  };
}

function esc(s: string | undefined | null): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function generateFatturaPAXml(data: FatturaPAData): string {
  const { cedente, cessionario, documento } = data;
  const progNum = String(documento.numero).padStart(7, "0");
  const idPaese = "IT";
  const idCodice = cedente.partitaIva.replace(/\s/g, "");

  const righeXml = documento.righe.map((r, i) => `
        <DettaglioLinee>
            <NumeroLinea>${i + 1}</NumeroLinea>
            <Descrizione>${esc(r.descrizione)}</Descrizione>
            <Quantita>${r.quantita}</Quantita>
            <PrezzoUnitario>${r.prezzoUnitario}</PrezzoUnitario>
            <PrezzoTotale>${r.importo}</PrezzoTotale>
            <AliquotaIVA>${r.aliquotaIva}</AliquotaIVA>
        </DettaglioLinee>`).join("");

  const aliquote = [...new Set(documento.righe.map(r => r.aliquotaIva))];
  const riepilogoXml = aliquote.map(aliq => {
    const rig = documento.righe.filter(r => r.aliquotaIva === aliq);
    const imponibile = rig.reduce((s, r) => s + parseFloat(r.importo), 0).toFixed(2);
    const iva = (parseFloat(imponibile) * parseFloat(aliq) / 100).toFixed(2);
    return `
        <DatiRiepilogo>
            <AliquotaIVA>${aliq}</AliquotaIVA>
            <ImponibileImporto>${imponibile}</ImponibileImporto>
            <Imposta>${iva}</Imposta>
            <EsigibilitaIVA>I</EsigibilitaIVA>
        </DatiRiepilogo>`;
  }).join("");

  const pagamentoXml = documento.metodoPagamento ? `
        <DatiPagamento>
            <CondizioniPagamento>TP02</CondizioniPagamento>
            <DettaglioPagamento>
                <ModalitaPagamento>${documento.metodoPagamento === "carta" ? "MP08" : "MP01"}</ModalitaPagamento>
                <ImportoPagamento>${documento.totale}</ImportoPagamento>
            </DettaglioPagamento>
        </DatiPagamento>` : "";

  const destinatarioSdi = cessionario.codiceDestinatario && cessionario.codiceDestinatario !== "0000000"
    ? `<CodiceDestinatario>${esc(cessionario.codiceDestinatario)}</CodiceDestinatario>`
    : cessionario.pec
      ? `<CodiceDestinatario>0000000</CodiceDestinatario><PECDestinatario>${esc(cessionario.pec)}</PECDestinatario>`
      : `<CodiceDestinatario>0000000</CodiceDestinatario>`;

  const cessionarioAnagrafica = cessionario.tipo === "azienda" || cessionario.partitaIva
    ? `<Denominazione>${esc(cessionario.ragioneSociale)}</Denominazione>`
    : `<Nome>${esc(cessionario.nome)}</Nome><Cognome>${esc(cessionario.cognome)}</Cognome>`;

  const cessionarioFiscale = cessionario.partitaIva
    ? `<IdFiscaleIVA><IdPaese>${cessionario.nazione}</IdPaese><IdCodice>${esc(cessionario.partitaIva)}</IdCodice></IdFiscaleIVA>`
    : cessionario.codiceFiscale
      ? `<CodiceFiscale>${esc(cessionario.codiceFiscale)}</CodiceFiscale>`
      : "";

  const cessionarioSede = (cessionario.indirizzo || cessionario.comune) ? `
                <Sede>
                    <Indirizzo>${esc(cessionario.indirizzo || "Via Sconosciuta 1")}</Indirizzo>
                    <CAP>${esc(cessionario.cap || "00000")}</CAP>
                    <Comune>${esc(cessionario.comune || "")}</Comune>
                    ${cessionario.provincia ? `<Provincia>${esc(cessionario.provincia)}</Provincia>` : ""}
                    <Nazione>${cessionario.nazione}</Nazione>
                </Sede>` : `
                <Sede>
                    <Indirizzo>Via Sconosciuta 1</Indirizzo>
                    <CAP>00000</CAP>
                    <Comune>Sconosciuto</Comune>
                    <Nazione>IT</Nazione>
                </Sede>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12"
    xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2"
    xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">
    <FatturaElettronicaHeader>
        <DatiTrasmissione>
            <IdTrasmittente>
                <IdPaese>${idPaese}</IdPaese>
                <IdCodice>${esc(idCodice)}</IdCodice>
            </IdTrasmittente>
            <ProgressivoInvio>${progNum}</ProgressivoInvio>
            <FormatoTrasmissione>FPR12</FormatoTrasmissione>
            ${destinatarioSdi}
        </DatiTrasmissione>
        <CedentePrestatore>
            <DatiAnagrafici>
                <IdFiscaleIVA>
                    <IdPaese>${idPaese}</IdPaese>
                    <IdCodice>${esc(cedente.partitaIva)}</IdCodice>
                </IdFiscaleIVA>
                ${cedente.codiceFiscale ? `<CodiceFiscale>${esc(cedente.codiceFiscale)}</CodiceFiscale>` : ""}
                <Anagrafica>
                    <Denominazione>${esc(cedente.denominazione)}</Denominazione>
                </Anagrafica>
                <RegimeFiscale>${esc(cedente.regimeFiscale)}</RegimeFiscale>
            </DatiAnagrafici>
            <Sede>
                <Indirizzo>${esc(cedente.indirizzo)}</Indirizzo>
                <CAP>${esc(cedente.cap)}</CAP>
                <Comune>${esc(cedente.comune)}</Comune>
                ${cedente.provincia ? `<Provincia>${esc(cedente.provincia)}</Provincia>` : ""}
                <Nazione>${esc(cedente.nazione)}</Nazione>
            </Sede>
        </CedentePrestatore>
        <CessionarioCommittente>
            <DatiAnagrafici>
                ${cessionarioFiscale}
                <Anagrafica>
                    ${cessionarioAnagrafica}
                </Anagrafica>
            </DatiAnagrafici>
            ${cessionarioSede}
        </CessionarioCommittente>
    </FatturaElettronicaHeader>
    <FatturaElettronicaBody>
        <DatiGenerali>
            <DatiGeneraliDocumento>
                <TipoDocumento>${esc(documento.tipoDocumento)}</TipoDocumento>
                <Divisa>EUR</Divisa>
                <Data>${esc(documento.data)}</Data>
                <Numero>${esc(documento.numero)}</Numero>
                ${documento.note ? `<Causale>${esc(documento.note)}</Causale>` : ""}
            </DatiGeneraliDocumento>
        </DatiGenerali>
        <DatiBeniServizi>${righeXml}
            ${riepilogoXml}
        </DatiBeniServizi>
        ${pagamentoXml}
    </FatturaElettronicaBody>
</p:FatturaElettronica>`;
}
