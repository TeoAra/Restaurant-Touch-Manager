import { rtDate } from "./fiscal-identity.ts";

type Counter = { stato: number; chiusura: number; docCommerciali: number };
type Identity = {
  errCode: string; scontrinoAperto: boolean; nonFiscaleAperto: boolean;
  matricola: string; data: string; numChiusura: string; numScontrino: string;
};

/** A socket acknowledgement is not evidence that a fiscal document was issued. */
export function fiscalEmissionEvidence(
  before: Counter | null, after: Counter | null,
  beforeIdentity: Identity | null, afterIdentity: Identity | null,
) {
  const counterAdvanced = !!before && !!after && before.stato === 0 && after.stato === 0 &&
    after.chiusura === before.chiusura && after.docCommerciali === before.docCommerciali + 1;
  const validIdentity = !!afterIdentity && Number(afterIdentity.errCode) === 0 &&
    !afterIdentity.scontrinoAperto && !afterIdentity.nonFiscaleAperto &&
    !!afterIdentity.matricola && !!rtDate(afterIdentity.data) &&
    Number.isInteger(Number(afterIdentity.numChiusura)) && Number(afterIdentity.numChiusura) >= 0 &&
    Number.isInteger(Number(afterIdentity.numScontrino)) && Number(afterIdentity.numScontrino) > 0;
  const identityAdvanced = validIdentity && !!beforeIdentity &&
    Number(beforeIdentity.errCode) === 0 && !beforeIdentity.scontrinoAperto &&
    beforeIdentity.matricola === afterIdentity!.matricola &&
    beforeIdentity.data === afterIdentity!.data &&
    Number(beforeIdentity.numChiusura) === Number(afterIdentity!.numChiusura) &&
    Number(afterIdentity!.numScontrino) === Number(beforeIdentity.numScontrino) + 1;
  const issued = counterAdvanced || identityAdvanced;
  // Q and 2X closure fields need not describe the same counter. Never fabricate a reference.
  const identity = issued && validIdentity && (!beforeIdentity || identityAdvanced) ? {
    numeroChiusura: Number(afterIdentity!.numChiusura),
    numeroDocumentoRt: Number(afterIdentity!.numScontrino),
    printerSerial: afterIdentity!.matricola,
    dataDocumentoRt: rtDate(afterIdentity!.data)!,
  } : null;
  return { issued, identity };
}
