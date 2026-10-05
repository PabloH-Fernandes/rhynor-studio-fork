// Vestiário: modal pra trocar o visual dos AGzinhos (nome, apelido, pele, cabelo, roupa e
// acessórios) e o "O que eu faço" do crachá, com o boneco girando ao vivo. Salvar manda o elenco inteiro no PUT /api/roster e
// todos os navegadores recebem pelo WS. As regras puras ficam em vestiarioLogic.ts.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type SyntheticEvent } from "react";
import { DEFAULT_ROSTER, ESTILOS_CABELO, GENEROS, HAIR_COLORS, ROUPAS_PERMITIDAS, SKIN_TONES } from "../../../shared/roster";
import type { Acessorio, AGzinho, Roster } from "../../../shared/types";
import { lookOfAgzinho } from "../office/engine";
import { PORTRAIT_H, PORTRAIT_W, drawCharacter, drawPortrait, type CharLook, type Dir } from "../office/sprites";
import { SPRITE_H, SPRITE_OX, SPRITE_OY, SPRITE_W } from "../office/spriteCache";
import { useDevicePixelRatio } from "./Cracha";
import {
  CAMADAS,
  LIMITE_APELIDO,
  LIMITE_NOME,
  LIMITE_O_QUE_FACO,
  LIMITE_RESPONSABILIDADE,
  MAX_RESPONSABILIDADES,
  MIN_RESPONSABILIDADES,
  NOME_ACESSORIO,
  NOME_CAMADA,
  NOME_ESTILO,
  NOME_ROUPA,
  acessorioDaCamada,
  acessoriosPorCamada,
  agzinhoDe,
  chavesSujas,
  conflitos,
  contarCaracteres,
  copiarVisual,
  elencoMaisNovo,
  errosPorCampo,
  lerErro,
  mensagemDeErro,
  mesmoElenco,
  opcoesDestaque,
  prepararEnvio,
  regraRoupa,
  trocarAcessorio,
  trocarDestaque,
  trocarGenero,
  trocarResponsabilidade,
  trocarRoupa,
  type Rascunhos,
  type TipoErro,
} from "./vestiarioLogic";

/** o giro da pré-visualização: frente, perfil direito, costas, perfil esquerdo */
const DIRS: readonly Dir[] = ["down", "right", "up", "left"];
const NOME_DIR: Record<Dir, string> = { down: "De frente", right: "Perfil direito", up: "De costas", left: "Perfil esquerdo" };
const GIRO_MS = 900;
/** recorte do quadro com o boneco inteiro (capacete, headset, prancheta e sombra cabem) */
const CORTE = { x: SPRITE_OX - 12, y: SPRITE_OY - 28, w: 24, h: 31 } as const;
const ESCALA_BONECO = 7;
const ESCALA_RETRATO = 4;
/** no celular o provador encolhe, pro formulário aparecer sem rolar tanto */
const CELULAR = "(max-width: 600px)";
const ESCALA_BONECO_CELULAR = 4;
const ESCALA_RETRATO_CELULAR = 3;
const ESCALA_MINI = 2;

const FOCAVEIS = "button, input, select, textarea, a[href], [tabindex]:not([tabindex=\"-1\"])";
const GRUPOS = acessoriosPorCamada();
const mesmaCor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

interface Props {
  /** elenco atual (atualiza sozinho pelo WS) */
  roster: Roster;
  /** key do AGzinho que abre selecionado */
  inicial: string;
  onClose: () => void;
}

export function Vestiario({ roster, inicial, onClose }: Props) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  // quem abriu recebe o foco de volta ao fechar
  const opener = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);

  /** última versão salva que este modal conhece */
  const [base, setBase] = useState<Roster>(roster);
  const [rascunhos, setRascunhos] = useState<Rascunhos>({});
  const [atual, setAtual] = useState(() => (agzinhoDe(roster, inicial) ? inicial : roster.agzinhos[0].key));
  const [enviando, setEnviando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  /** depois da 1ª tentativa de salvar, os erros do front aparecem (e somem conforme corrige) */
  const [tentou, setTentou] = useState(false);
  const [errosServidor, setErrosServidor] = useState<{ tipo: TipoErro; erros: string[] }>({ tipo: "validacao", erros: [] });
  const [confirmarPadrao, setConfirmarPadrao] = useState(false);
  const [avisoFechar, setAvisoFechar] = useState(false);

  const salvoAtual = agzinhoDe(base, atual) ?? base.agzinhos[0];
  const ed = rascunhos[atual] ?? salvoAtual;
  const sujas = useMemo(() => chavesSujas(base, rascunhos), [base, rascunhos]);
  const sujo = sujas.includes(atual);
  const padrao = agzinhoDe(DEFAULT_ROSTER, atual);

  // ---- elenco novo pelo WS: adota sozinho, menos quando mexe em algo que você está editando.
  // Só o mais novo (atualizadoEm): se a resposta do PUT chegou antes do WS, o WS atrasado não
  // devolve o elenco antigo (e um Salvar depois não desfaz o que acabou de gravar).
  const mudouFora = !enviando && elencoMaisNovo(base, roster) && !mesmoElenco(base, roster);
  const emConflito = useMemo(() => (mudouFora ? conflitos(base, roster, rascunhos) : []), [mudouFora, base, roster, rascunhos]);
  useEffect(() => {
    if (!mudouFora || emConflito.length) return;
    setBase(roster);
    // rascunho que não mudava nada vira sujo contra o elenco novo: some
    setRascunhos((r) => Object.fromEntries(Object.entries(r).filter(([k]) => sujas.includes(k))));
  }, [mudouFora, emConflito, roster, sujas]);

  const recarregar = () => {
    setRascunhos((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !emConflito.includes(k))));
    setBase(roster);
  };
  const manterEdicao = () => setBase(roster);

  // ---- erros: os do front (ao vivo) ou, se o front aceitou, os do servidor
  const envio = useMemo(() => prepararEnvio(base, rascunhos), [base, rascunhos]);
  const errosFront = envio.ok ? [] : envio.erros;
  const erros = tentou ? (errosFront.length ? errosFront : errosServidor.erros) : [];
  const tipoErro: TipoErro = errosFront.length ? "validacao" : errosServidor.tipo;
  const porCampo = errosPorCampo(erros, atual);
  const elencoMostrado = useMemo(() => ({ ...base, agzinhos: base.agzinhos.map((a) => rascunhos[a.key] ?? a) }), [base, rascunhos]);

  const editar = (fn: (a: AGzinho) => AGzinho) => {
    setRascunhos((r) => ({ ...r, [atual]: fn(r[atual] ?? salvoAtual) }));
    setSalvo(false);
    setErrosServidor({ tipo: "validacao", erros: [] });
    setConfirmarPadrao(false);
  };

  const desfazer = () => {
    setRascunhos(({ [atual]: _fora, ...resto }) => resto);
    setConfirmarPadrao(false);
  };

  const voltarAoPadrao = () => {
    if (padrao) editar((a) => copiarVisual(a, padrao));
    setConfirmarPadrao(false);
  };

  const podeSalvar = !enviando && sujas.length > 0 && emConflito.length === 0;
  const salvar = async () => {
    if (!podeSalvar) return;
    setTentou(true);
    setSalvo(false);
    setErrosServidor({ tipo: "validacao", erros: [] });
    if (!envio.ok) return;
    setEnviando(true);
    try {
      const res = await fetch("/api/roster", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envio.roster),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; roster?: Roster; erros?: string[] } | null;
      if (res.ok && body?.ok && body.roster) {
        setBase(body.roster);
        setRascunhos({});
        setSalvo(true);
        setTentou(false);
      } else {
        // 400 traz a lista da validação; o resto é falha do servidor
        if (res.status === 400 && body?.erros?.length) setErrosServidor({ tipo: "validacao", erros: body.erros });
        else setErrosServidor({ tipo: "servidor", erros: body?.erros?.length ? body.erros : [`O servidor respondeu com erro ${res.status}. Tente de novo.`] });
      }
    } catch {
      setErrosServidor({ tipo: "servidor", erros: ["Sem conexão com o servidor. Confira se ele está rodando e tente de novo."] });
    } finally {
      setEnviando(false);
    }
  };

  // ---- abrir, fechar e Esc
  useLayoutEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) {
      d.showModal();
      // começa em quem está sendo editado (no celular, focar um campo de texto abriria o teclado)
      d.querySelector<HTMLElement>(".vest-pessoa[aria-current]")?.focus();
    }
    const back = opener.current;
    document.documentElement.classList.add("vest-aberto");
    return () => {
      document.documentElement.classList.remove("vest-aberto");
      if (d?.open) d.close();
      const alvo = back?.isConnected ? back : document.querySelector<HTMLElement>(".btn-vestiario");
      alvo?.focus();
    };
  }, []);

  /** ligado só pelo fechar(): qualquer outro fechamento com rascunho é desfeito */
  const fechandoRef = useRef(false);
  // o evento "close" chega depois (tarefa); no StrictMode o modal já reabriu: ignora
  const aoFechar = () => {
    const d = dialogRef.current;
    if (!d || d.open) return;
    if (!fechandoRef.current && sujas.length) {
      // rede de segurança: o navegador fechou sozinho (Esc repetido no Chrome) com alteração não salva
      d.showModal();
      setAvisoFechar(true);
      return;
    }
    onClose();
  };
  const fechar = useCallback(() => {
    fechandoRef.current = true;
    dialogRef.current?.close();
  }, []);
  const pedirFechar = () => {
    if (sujas.length) setAvisoFechar(true);
    else fechar();
  };

  // o <dialog> modal deixa o Tab sair pra barra do navegador: do último volta pro primeiro e vice-versa
  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    // Esc tratado aqui: o Chrome ignora o preventDefault do "cancel" num segundo Esc seguido
    if (e.key === "Escape") {
      e.preventDefault();
      tratarEsc();
      return;
    }
    if (e.key !== "Tab") return;
    const focaveis = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCAVEIS)].filter((el) => !el.matches(":disabled") && el.offsetParent !== null);
    // radios do mesmo grupo: só o marcado (ou o primeiro) entra na ordem do Tab
    const ordem = focaveis.filter((el) => !(el instanceof HTMLInputElement && el.type === "radio" && !el.checked && focaveis.some((o) => o !== el && o instanceof HTMLInputElement && o.name === el.name && o.checked)));
    if (!ordem.length) return;
    const primeiro = ordem[0];
    const ultimo = ordem[ordem.length - 1];
    const ativo = document.activeElement;
    const noUltimo = ativo === ultimo || (ativo instanceof HTMLInputElement && ultimo instanceof HTMLInputElement && ativo.name !== "" && ativo.name === ultimo.name);
    const noPrimeiro = ativo === primeiro || (ativo instanceof HTMLInputElement && primeiro instanceof HTMLInputElement && ativo.name !== "" && ativo.name === primeiro.name);
    if (!e.shiftKey && noUltimo) {
      e.preventDefault();
      primeiro.focus();
    } else if (e.shiftKey && noPrimeiro) {
      e.preventDefault();
      ultimo.focus();
    }
  };

  // Esc: fecha primeiro a confirmação aberta; com alteração não salva, avisa em vez de fechar
  const tratarEsc = () => {
    if (confirmarPadrao) setConfirmarPadrao(false);
    else if (avisoFechar) setAvisoFechar(false);
    else pedirFechar();
  };
  // outros pedidos de fechar (botão voltar do Android...)
  const onCancel = (e: SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    tratarEsc();
  };

  // a confirmação inline recebe o foco quando aparece
  const confirmaRef = useRef<HTMLButtonElement>(null);
  const avisoRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmarPadrao) confirmaRef.current?.focus();
  }, [confirmarPadrao]);
  useEffect(() => {
    if (avisoFechar) avisoRef.current?.focus();
  }, [avisoFechar]);
  useEffect(() => {
    if (!sujas.length) setAvisoFechar(false);
  }, [sujas.length]);

  const look = useMemo(() => lookOfAgzinho(ed), [ed]);
  const roupas = ROUPAS_PERMITIDAS(ed.papel);
  const regra = regraRoupa(ed.papel);
  const destaques = opcoesDestaque(ed.papel, ed.roupa);
  const apelidoDe = (k: string) => agzinhoDe(elencoMostrado, k)?.apelido.trim() || agzinhoDe(elencoMostrado, k)?.nome || k;
  const campoErro = (campo: string) => porCampo[campo]?.join(" · ");

  return (
    <dialog ref={dialogRef} className="vest" aria-labelledby={`${id}-titulo`} aria-describedby={`${id}-sub`} onCancel={onCancel} onClose={aoFechar} onKeyDown={onKeyDown}>
      <header className="vest-topo">
        <div>
          <h2 id={`${id}-titulo`} className="vest-titulo">
            Vestiário
          </h2>
          <p id={`${id}-sub`} className="vest-sub">
            Troque o visual dos AGzinhos.
          </p>
        </div>
        <button type="button" className="vest-x" aria-label="Fechar vestiário" title="Fechar (Esc)" onClick={pedirFechar}>
          ×
        </button>
      </header>

      <div className="vest-corpo">
        <nav className="vest-elenco" aria-label="Elenco">
          <ul>
            {elencoMostrado.agzinhos.map((a) => {
              const naoSalvo = sujas.includes(a.key);
              return (
                <li key={a.key}>
                  <button
                    type="button"
                    className="vest-pessoa"
                    aria-current={a.key === atual ? "true" : undefined}
                    onClick={() => {
                      setAtual(a.key);
                      setConfirmarPadrao(false);
                    }}
                  >
                    <MiniRetrato ag={a} />
                    <span className="vest-pessoa-nome">{a.apelido.trim() || "Sem apelido"}</span>
                    {naoSalvo && (
                      <span className="vest-pessoa-sujo" title="Alteração não salva">
                        <span className="sr-only">, alteração não salva</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="vest-form">
          {emConflito.length > 0 && (
            <div className="vest-conflito" role="alert">
              <p>
                <strong>O elenco foi alterado em outro navegador</strong> ({emConflito.map(apelidoDe).join(", ")}). Recarregar
                descarta a sua edição desses AGzinhos.
              </p>
              <div className="vest-linha-botoes">
                <button type="button" className="btn" onClick={recarregar}>
                  Recarregar
                </button>
                <button type="button" className="btn ghost" onClick={manterEdicao}>
                  Manter minha edição
                </button>
              </div>
            </div>
          )}

          <h3 className="vest-quem">
            {ed.nome.trim() || "Sem nome"} <span className="vest-quem-cargo">· {ed.cargo}</span>
          </h3>

          <div className="vest-campos-texto">
            <TextoCampo
              id={`${id}-nome`}
              rotulo="Nome"
              valor={ed.nome}
              max={LIMITE_NOME}
              erro={campoErro("nome")}
              onChange={(v) => editar((a) => ({ ...a, nome: v }))}
            />
            <TextoCampo
              id={`${id}-apelido`}
              rotulo="Apelido"
              valor={ed.apelido}
              max={LIMITE_APELIDO}
              erro={campoErro("apelido")}
              onChange={(v) => editar((a) => ({ ...a, apelido: v }))}
              caixaAlta
            />
          </div>

          <fieldset className="vest-grupo">
            <legend>Gênero</legend>
            <div className="vest-chips">
              {GENEROS.map((g) => (
                <Chip
                  key={g}
                  name={`${id}-genero`}
                  rotulo={g === "feminino" ? "Feminino" : "Masculino"}
                  checked={ed.genero === g}
                  onChange={() => editar((a) => trocarGenero(a, g))}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="vest-grupo" aria-describedby={campoErro("pele") ? `${id}-erro-pele` : undefined}>
            <legend>Tom de pele</legend>
            <div className="vest-amostras">
              {SKIN_TONES.map((t) => (
                <Amostra
                  key={t.id}
                  name={`${id}-pele`}
                  cor={t.hex}
                  rotulo={`Pele ${t.nome.toLocaleLowerCase("pt-BR")}`}
                  checked={mesmaCor(ed.pele, t.hex)}
                  onChange={() => editar((a) => ({ ...a, pele: t.hex }))}
                />
              ))}
            </div>
            <ErroCampo id={`${id}-erro-pele`} texto={campoErro("pele")} />
          </fieldset>

          <fieldset className="vest-grupo">
            <legend>Estilo do cabelo</legend>
            <div className="vest-chips">
              {ESTILOS_CABELO.map((s) => (
                <Chip
                  key={s}
                  name={`${id}-estilo`}
                  rotulo={NOME_ESTILO[s]}
                  checked={ed.cabelo.estilo === s}
                  onChange={() => editar((a) => ({ ...a, cabelo: { ...a.cabelo, estilo: s } }))}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="vest-grupo" aria-describedby={campoErro("cabelo.cor") ? `${id}-erro-cabelo` : undefined}>
            <legend>Cor do cabelo</legend>
            <div className="vest-amostras">
              {HAIR_COLORS.map((c) => (
                <Amostra
                  key={c.id}
                  name={`${id}-cabelo`}
                  cor={c.hex}
                  rotulo={`Cabelo ${c.nome.toLocaleLowerCase("pt-BR")}`}
                  checked={mesmaCor(ed.cabelo.cor, c.hex)}
                  onChange={() => editar((a) => ({ ...a, cabelo: { ...a.cabelo, cor: c.hex } }))}
                />
              ))}
            </div>
            <ErroCampo id={`${id}-erro-cabelo`} texto={campoErro("cabelo.cor")} />
          </fieldset>

          <fieldset className="vest-grupo" aria-describedby={campoErro("roupa") ? `${id}-erro-roupa` : undefined}>
            <legend>Roupa</legend>
            {regra ? (
              <p className="vest-fixo">{regra}</p>
            ) : (
              <div className="vest-chips">
                {roupas.map((r) => (
                  <Chip key={r} name={`${id}-roupa`} rotulo={NOME_ROUPA[r]} checked={ed.roupa === r} onChange={() => editar((a) => trocarRoupa(a, r))} />
                ))}
              </div>
            )}
            <ErroCampo id={`${id}-erro-roupa`} texto={campoErro("roupa")} />
          </fieldset>

          {destaques.length > 0 && (
            <fieldset className="vest-grupo" aria-describedby={campoErro("destaque") ? `${id}-erro-destaque` : undefined}>
              <legend>Destaque</legend>
              {destaques.length === 1 ? (
                <p className="vest-fixo">{destaques[0].nome}: obrigatório para convidados</p>
              ) : (
                <div className="vest-chips">
                  {destaques.map((d) => (
                    <Chip
                      key={d.valor ?? "nenhum"}
                      name={`${id}-destaque`}
                      rotulo={d.nome}
                      checked={ed.destaque === d.valor}
                      onChange={() => editar((a) => trocarDestaque(a, d.valor))}
                    />
                  ))}
                </div>
              )}
              <ErroCampo id={`${id}-erro-destaque`} texto={campoErro("destaque")} />
            </fieldset>
          )}

          <fieldset className="vest-grupo vest-acessorios" aria-describedby={campoErro("acessorios") ? `${id}-erro-acessorios` : undefined}>
            <legend>Acessórios (um por parte do corpo)</legend>
            {CAMADAS.filter((c) => GRUPOS[c].length).map((camada) => {
              const escolhido = acessorioDaCamada(ed.acessorios, camada);
              const trocar = (novo: Acessorio | null) => editar((a) => ({ ...a, acessorios: trocarAcessorio(a.acessorios, camada, novo) }));
              return (
                <fieldset key={camada} className="vest-camada">
                  <legend>{NOME_CAMADA[camada]}</legend>
                  <div className="vest-chips">
                    <Chip name={`${id}-ac-${camada}`} rotulo="Nenhum" checked={!escolhido} onChange={() => trocar(null)} />
                    {GRUPOS[camada].map((ac) => (
                      <Chip key={ac} name={`${id}-ac-${camada}`} rotulo={NOME_ACESSORIO[ac]} checked={escolhido === ac} onChange={() => trocar(ac)} />
                    ))}
                  </div>
                </fieldset>
              );
            })}
            <ErroCampo id={`${id}-erro-acessorios`} texto={campoErro("acessorios")} />
          </fieldset>

          <fieldset className="vest-grupo vest-funcao" aria-describedby={`${id}-funcao-dica`}>
            <legend>Crachá: o que eu faço</legend>
            <p id={`${id}-funcao-dica`} className="vest-dica">
              Escreva para quem não é de TI: uma frase e de {MIN_RESPONSABILIDADES} a {MAX_RESPONSABILIDADES} responsabilidades.
            </p>
            <TextoCampo
              id={`${id}-oquefaco`}
              rotulo="Frase"
              valor={ed.oQueFaco}
              max={LIMITE_O_QUE_FACO}
              erro={campoErro("oQueFaco")}
              onChange={(v) => editar((a) => ({ ...a, oQueFaco: v }))}
              multilinha
            />
            {Array.from({ length: MAX_RESPONSABILIDADES }, (_, i) => (
              <TextoCampo
                key={i}
                id={`${id}-resp-${i}`}
                rotulo={`Sou responsável por, item ${i + 1}${i >= MIN_RESPONSABILIDADES ? " (opcional)" : ""}`}
                valor={ed.responsabilidades[i] ?? ""}
                max={LIMITE_RESPONSABILIDADE}
                invalido={!!campoErro("responsabilidades")}
                descritoPor={campoErro("responsabilidades") ? `${id}-erro-responsabilidades` : undefined}
                onChange={(v) => editar((a) => ({ ...a, responsabilidades: trocarResponsabilidade(a.responsabilidades, i, v) }))}
              />
            ))}
            <ErroCampo id={`${id}-erro-responsabilidades`} texto={campoErro("responsabilidades")} />
          </fieldset>

          <section className="vest-grupo" aria-labelledby={`${id}-fixos`}>
            <h4 id={`${id}-fixos`} className="vest-legenda">
              Vem do papel (o cargo acompanha o gênero)
            </h4>
            <dl className="vest-fixos">
              <div>
                <dt>Cordão</dt>
                <dd>
                  <span className="vest-cordao" style={{ "--cordao": ed.cordao } as CSSProperties} aria-hidden="true" />
                  Cor do papel
                </dd>
              </div>
              <div>
                <dt>Matrícula</dt>
                <dd translate="no">{ed.matricula}</dd>
              </div>
              <div>
                <dt>Cargo</dt>
                <dd>{ed.cargo}</dd>
              </div>
            </dl>
          </section>
        </div>

        <aside className="vest-provador" aria-label="Pré-visualização">
          <Provador look={look} nome={ed.nome.trim() || ed.apelido || ed.key} />
        </aside>
      </div>

      <footer className="vest-rodape">
        {/* só as mensagens rolam: em tela baixa os botões de salvar e fechar continuam à vista */}
        {(erros.length > 0 || (confirmarPadrao && padrao) || avisoFechar) && (
          <div className="vest-mensagens">
            {erros.length > 0 && (
              <div className="vest-erros" role="alert">
                <p>
                  {tipoErro === "servidor" ? (
                    <strong>O servidor não salvou o elenco.</strong>
                  ) : (
                    <>
                      <strong>Não deu pra salvar.</strong> Corrija {erros.length === 1 ? "o item" : `os ${erros.length} itens`}:
                    </>
                  )}
                </p>
                <ul>
                  {erros.map((e) => {
                    const key = lerErro(e).key;
                    const texto = mensagemDeErro(e, elencoMostrado);
                    return (
                      <li key={e}>
                        {key && key !== atual && agzinhoDe(base, key) ? (
                          <button type="button" className="vest-erro-link" onClick={() => setAtual(key)}>
                            {texto}
                          </button>
                        ) : (
                          texto
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {confirmarPadrao && padrao && (
              <div className="vest-confirma" role="group" aria-labelledby={`${id}-confirma`}>
                <p id={`${id}-confirma`}>
                  Voltar {apelidoDe(atual)} ao visual padrão ({padrao.apelido})? Nome, apelido, pele, cabelo, roupa, acessórios e o texto do crachá voltam ao que eram. Só
                  vale depois de salvar.
                </p>
                <div className="vest-linha-botoes">
                  <button ref={confirmaRef} type="button" className="btn" onClick={voltarAoPadrao}>
                    Sim, voltar ao padrão
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setConfirmarPadrao(false)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {avisoFechar && (
              <div className="vest-confirma" role="group" aria-labelledby={`${id}-aviso`}>
                <p id={`${id}-aviso`}>
                  Tem alteração não salva em {sujas.map(apelidoDe).join(", ")}. Fechar descarta essas alterações.
                </p>
                <div className="vest-linha-botoes">
                  <button ref={avisoRef} type="button" className="btn ghost" onClick={() => setAvisoFechar(false)}>
                    Continuar editando
                  </button>
                  <button type="button" className="btn" onClick={fechar}>
                    Descartar e fechar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="vest-acoes">
          <div className="vest-acoes-esq">
            <button
              type="button"
              className="btn ghost"
              disabled={!padrao || enviando}
              title={padrao ? undefined : "Este AGzinho não existe no elenco padrão"}
              onClick={() => setConfirmarPadrao(true)}
            >
              Voltar ao padrão
            </button>
            <button type="button" className="btn ghost" disabled={!sujo || enviando} onClick={desfazer}>
              Desfazer
            </button>
          </div>
          <p className="vest-estado" role="status">
            {enviando
              ? "Salvando..."
              : salvo
                ? "Salvo ✓"
                : emConflito.length
                  ? "Escolha uma opção para poder salvar"
                  : sujas.length
                    ? `${sujas.length === 1 ? "1 AGzinho" : `${sujas.length} AGzinhos`} com alteração não salva`
                    : ""}
          </p>
          <div className="vest-acoes-dir">
            <button type="button" className="btn ghost" onClick={pedirFechar}>
              Fechar
            </button>
            {/* aria-disabled em vez de disabled: depois de salvar o foco continua no botão */}
            <button type="button" className="btn primary" aria-disabled={!podeSalvar} aria-busy={enviando} onClick={salvar}>
              {enviando ? "Salvando..." : sujas.length > 1 ? `Salvar (${sujas.length})` : "Salvar"}
            </button>
          </div>
        </div>
      </footer>
    </dialog>
  );
}

// ------------------------------------------------------------------ campos

function TextoCampo(props: {
  id: string;
  rotulo: string;
  valor: string;
  max: number;
  erro?: string;
  caixaAlta?: boolean;
  /** textarea (frase do crachá) em vez de input; frase tem acento e pontuação, então com corretor */
  multilinha?: boolean;
  /** erro de um grupo (ex.: responsabilidades): marca o campo e aponta pro texto do erro do grupo */
  invalido?: boolean;
  descritoPor?: string;
  onChange: (v: string) => void;
}) {
  const { id, rotulo, valor, max, erro, caixaAlta, multilinha, invalido, descritoPor, onChange } = props;
  const n = contarCaracteres(valor);
  const comum = {
    id,
    value: valor,
    maxLength: max,
    autoComplete: "off",
    "aria-invalid": erro || invalido ? true : undefined,
    "aria-describedby": [`${id}-cont`, erro && `${id}-erro`, descritoPor].filter(Boolean).join(" "),
  } as const;
  return (
    <div className="vest-texto">
      <label htmlFor={id}>{rotulo}</label>
      {multilinha ? (
        <textarea {...comum} rows={2} spellCheck onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          {...comum}
          type="text"
          className={caixaAlta ? "vest-caixa-alta" : undefined}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <span id={`${id}-cont`} className="vest-contador">
        <span className="sr-only">Caracteres usados: </span>
        {n}/{max}
      </span>
      <ErroCampo id={`${id}-erro`} texto={erro} />
    </div>
  );
}

function ErroCampo({ id, texto }: { id: string; texto?: string }) {
  if (!texto) return null;
  return (
    <p id={id} className="vest-erro-campo">
      {texto}
    </p>
  );
}

function Chip(props: { name: string; rotulo: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="vest-chip">
      <input type="radio" name={props.name} checked={props.checked} onChange={props.onChange} />
      <span>{props.rotulo}</span>
    </label>
  );
}

function Amostra(props: { name: string; cor: string; rotulo: string; checked: boolean; onChange: () => void }) {
  return (
    <input
      type="radio"
      className="vest-amostra"
      name={props.name}
      aria-label={props.rotulo}
      title={props.rotulo}
      checked={props.checked}
      onChange={props.onChange}
      style={{ "--amostra": props.cor } as CSSProperties}
    />
  );
}

// ------------------------------------------------------------------ desenhos (sem o cache dos bonecos)

/** pixels de tela por pixel da arte, sempre inteiros */
function escalaInteira(canvas: HTMLCanvasElement, w: number, h: number, escala: number, dpr: number): number {
  const k = Math.max(1, Math.round(escala * dpr));
  canvas.width = w * k;
  canvas.height = h * k;
  canvas.style.width = `${(w * k) / dpr}px`;
  canvas.style.height = `${(h * k) / dpr}px`;
  return k;
}

function MiniRetrato({ ag }: { ag: AGzinho }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dpr = useDevicePixelRatio();
  const look = useMemo(() => lookOfAgzinho(ag), [ag]);
  useLayoutEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const k = escalaInteira(canvas, PORTRAIT_W, PORTRAIT_H, ESCALA_MINI, dpr);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawPortrait(ctx, look, k, 0, 0, false);
  }, [look, dpr]);
  return <canvas ref={ref} className="vest-mini" aria-hidden="true" width={PORTRAIT_W * ESCALA_MINI} height={PORTRAIT_H * ESCALA_MINI} />;
}

/** media query que acompanha mudanças (girar o celular, mudar a preferência de movimento) */
function useMedia(query: string) {
  const [ok, setOk] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setOk(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return ok;
}

const usePrefersReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");

/** boneco de corpo inteiro girando e o retrato do crachá; o visual não salvo não entra no cache */
function Provador({ look, nome }: { look: CharLook; nome: string }) {
  const corpoRef = useRef<HTMLCanvasElement>(null);
  const fotoRef = useRef<HTMLCanvasElement>(null);
  const quadroRef = useRef<HTMLCanvasElement | null>(null);
  const dpr = useDevicePixelRatio();
  const reduced = usePrefersReducedMotion();
  const celular = useMedia(CELULAR);
  const escalaBoneco = celular ? ESCALA_BONECO_CELULAR : ESCALA_BONECO;
  const escalaRetrato = celular ? ESCALA_RETRATO_CELULAR : ESCALA_RETRATO;
  const [pausado, setPausado] = useState(false);
  const [i, setI] = useState(0);
  const girando = !reduced && !pausado;
  const dir = DIRS[i];

  useEffect(() => {
    if (!girando) return;
    const t = setInterval(() => setI((n) => (n + 1) % DIRS.length), GIRO_MS);
    return () => clearInterval(t);
  }, [girando]);

  useLayoutEffect(() => {
    const canvas = corpoRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // quadro 1x num canvas solto e depois ampliado em escala inteira
    const quadro = (quadroRef.current ??= document.createElement("canvas"));
    quadro.width = SPRITE_W;
    quadro.height = SPRITE_H;
    const q = quadro.getContext("2d");
    if (!q) return;
    q.imageSmoothingEnabled = false;
    drawCharacter(q, SPRITE_OX, SPRITE_OY, look, { dir, walking: false, sitting: false, typing: false, t: 0, phase: 0, animT: 0, noIdle: true }, false);
    const k = escalaInteira(canvas, CORTE.w, CORTE.h, escalaBoneco, dpr);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(quadro, CORTE.x, CORTE.y, CORTE.w, CORTE.h, 0, 0, CORTE.w * k, CORTE.h * k);
  }, [look, dir, dpr, escalaBoneco]);

  useLayoutEffect(() => {
    const canvas = fotoRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const k = escalaInteira(canvas, PORTRAIT_W, PORTRAIT_H, escalaRetrato, dpr);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawPortrait(ctx, look, k, 0, 0, false);
  }, [look, dpr, escalaRetrato]);

  const girar = (passo: number) => {
    setPausado(true);
    setI((n) => (n + passo + DIRS.length) % DIRS.length);
  };

  return (
    <div className="provador">
      <div className="provador-espelho">
        <canvas
          ref={corpoRef}
          className="provador-corpo"
          role="img"
          aria-label={`${nome} de corpo inteiro, ${NOME_DIR[dir].toLocaleLowerCase("pt-BR")}`}
          width={CORTE.w * ESCALA_BONECO}
          height={CORTE.h * ESCALA_BONECO}
        />
        <div className="provador-foto">
          <canvas
            ref={fotoRef}
            role="img"
            aria-label={`Retrato do crachá de ${nome}`}
            width={PORTRAIT_W * ESCALA_RETRATO}
            height={PORTRAIT_H * ESCALA_RETRATO}
          />
          <span className="provador-foto-legenda">Crachá</span>
        </div>
      </div>
      <div className="provador-giro">
        <button type="button" className="btn ghost provador-seta" aria-label="Girar para a esquerda" onClick={() => girar(-1)}>
          ◀
        </button>
        <span className="provador-dir" aria-live={girando ? "off" : "polite"}>
          {NOME_DIR[dir]}
        </span>
        <button type="button" className="btn ghost provador-seta" aria-label="Girar para a direita" onClick={() => girar(1)}>
          ▶
        </button>
      </div>
      {!reduced && (
        <button type="button" className="btn ghost provador-pausa" onClick={() => setPausado((p) => !p)}>
          {pausado ? "Voltar a girar" : "Parar o giro"}
        </button>
      )}
    </div>
  );
}
