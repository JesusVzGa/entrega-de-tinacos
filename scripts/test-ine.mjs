import assert from "node:assert/strict";
import { parseINE, parseINERegion } from "../lib/delivery.ts";
assert.deepEqual(parseINE("ruido | N0M8RE SEXO M\nPEREZ\nGARCIA\nANA MARIA\nxx D0MICILI0: CALLE PRUEBA 123\nCOL CENTRO 12345\nCIUDAD PRUEBA\nCLAVE DE ELECTOR ABC"), {
 nombre:"PEREZ GARCIA ANA MARIA", direccion:"CALLE PRUEBA 123 COL CENTRO 12345 CIUDAD PRUEBA"
});
assert.deepEqual(parseINE("NOMBRE: ANA MARIA PEREZ DOMICILIO: CALLE PRUEBA 5\nCLAVE DE ELECTOR ABC"), {
 nombre:"ANA MARIA PEREZ", direccion:"CALLE PRUEBA 5"
});
assert.equal(parseINERegion("PEREZ\nGARCIA\nANA MARIA", "nombre"), "PEREZ GARCIA ANA MARIA");
assert.equal(parseINERegion("CALLE PRUEBA 123\nCOL CENTRO 12345\nCIUDAD PRUEBA\nCURP XXXXX", "direccion"), "CALLE PRUEBA 123 COL CENTRO 12345 CIUDAD PRUEBA");
assert.equal(parseINERegion("NOMBRE\nPEREZ\nGARCIA\nANA MARIA", "nombre"), "PEREZ GARCIA ANA MARIA");
assert.equal(parseINERegion("INSTITUTO NACIONAL ELECTORAL\nCREDENCIAL PARA VOTAR\n1234567890", "nombre"), "");
assert.equal(parseINE("imagen sin datos").nombre, "");
console.log("PASS: noisy labels, zero/eight OCR substitutions, adjacent SEXO, inline sections, unlabelled selected regions and exclusion of identity numbers.");

