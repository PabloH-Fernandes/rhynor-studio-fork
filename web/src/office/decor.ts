// Cenário em pixel art, dividido em três arquivos (este só reexporta, os imports de "./decor" não mudam):
//  - decorBase.ts: primitivas de desenho (fill, line, disc, oval, mix, hexToRgb, Rect)
//  - decorJanela.ts: vista das janelas, pôsteres e estante do estúdio
//  - decorMoveis.ts: mobília do chão (plantas, sofás, impressora, cabideiro, recepção, ping-pong, bebedouro)

export * from "./decorBase";
export * from "./decorJanela";
export * from "./decorMoveis";
