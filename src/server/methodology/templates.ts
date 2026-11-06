/**
 * Templates iniciais de metodologia. São PONTOS DE PARTIDA editáveis:
 * cada empresa ajusta critérios, pesos e, principalmente, as âncoras
 * (o que é 0, 5 e 10 na realidade dela) durante a calibração.
 */
export type TemplateCriterion = {
  key: string;
  competency: string;
  name: string;
  description: string;
  anchors: { "0": string; "5": string; "10": string };
  weight: number;
  mandatory?: boolean;
  applicability?: string;
};

export type MethodologyTemplate = {
  key: "spin" | "challenger" | "consultative" | "sdr_qualification" | "closer_discovery";
  name: string;
  appliesTo: "sdr" | "closer" | "any";
  description: string;
  guidance: string;
  criteria: TemplateCriterion[];
};

const opening: TemplateCriterion = {
  key: "abertura_agenda",
  competency: "Condução",
  name: "Abertura e agenda",
  description: "Apresenta-se, confirma o tempo disponível e combina o objetivo da conversa com o cliente.",
  anchors: {
    "0": "Entra direto no assunto, sem combinar objetivo nem tempo.",
    "5": "Apresenta-se e cita o objetivo, mas não valida com o cliente.",
    "10": "Combina objetivo, tempo e formato e obtém concordância explícita do cliente.",
  },
  weight: 1,
};

const nextSteps: TemplateCriterion = {
  key: "proximo_passo",
  competency: "Avanço",
  name: "Próximo passo confirmado",
  description: "Encerra com próximo passo concreto: data, responsáveis e participantes definidos e aceitos pelo cliente.",
  anchors: {
    "0": "Termina sem próximo passo ou com algo vago (\"te mando um e-mail\").",
    "5": "Propõe um próximo passo, mas sem data ou sem confirmação do cliente.",
    "10": "Data, horário, participantes e objetivo do próximo passo confirmados pelo cliente.",
  },
  weight: 2,
  mandatory: true,
};

const listening: TemplateCriterion = {
  key: "escuta_ativa",
  competency: "Comunicação",
  name: "Escuta ativa",
  description: "Deixa o cliente falar, resume o que ouviu e aprofunda a partir das respostas, sem interromper.",
  anchors: {
    "0": "Monopoliza a conversa ou ignora o que o cliente diz.",
    "5": "Escuta, mas raramente aprofunda ou resume.",
    "10": "Resume com as palavras do cliente e faz perguntas de aprofundamento sobre o que ele disse.",
  },
  weight: 1,
};

const objections: TemplateCriterion = {
  key: "tratamento_objecoes",
  competency: "Objeções",
  name: "Tratamento de objeções",
  description: "Explora a objeção antes de responder, entende a causa real e responde com argumentos ligados à necessidade do cliente.",
  anchors: {
    "0": "Ignora, discute ou responde de forma defensiva.",
    "5": "Responde à objeção, mas sem entender a causa.",
    "10": "Investiga a objeção, valida o entendimento e responde conectando ao valor para o cliente.",
  },
  weight: 1.5,
  applicability: "Aplicável somente se o cliente levantar alguma objeção (preço, prazo, concorrente, prioridade etc.).",
};

export const METHODOLOGY_TEMPLATES: MethodologyTemplate[] = [
  {
    key: "sdr_qualification",
    name: "Qualificação SDR",
    appliesTo: "sdr",
    description: "Ligação de qualificação/prospecção: gerar interesse, qualificar e agendar a reunião com o Closer.",
    guidance: "Avalie como uma ligação de SDR. O objetivo principal é qualificar e agendar, não vender o produto.",
    criteria: [
      { ...opening, key: "abertura_gancho", name: "Abertura e gancho", description: "Abre com contexto relevante para o cliente e um motivo claro para a conversa continuar.", weight: 1 },
      {
        key: "qualificacao_dor",
        competency: "Qualificação",
        name: "Identificação da dor",
        description: "Descobre o problema ou objetivo do cliente com perguntas abertas.",
        anchors: { "0": "Não pergunta sobre o problema do cliente.", "5": "Identifica um problema superficial.", "10": "Identifica dor concreta, com impacto e urgência." },
        weight: 2,
        mandatory: true,
      },
      {
        key: "qualificacao_fit",
        competency: "Qualificação",
        name: "Critérios de qualificação",
        description: "Verifica os critérios de qualificação definidos pela empresa (ex.: porte, decisor, orçamento, prazo).",
        anchors: { "0": "Nenhum critério verificado.", "5": "Parte dos critérios verificada.", "10": "Todos os critérios relevantes verificados com clareza." },
        weight: 2,
      },
      { ...listening },
      { ...objections },
      { ...nextSteps, key: "agendamento", name: "Agendamento da reunião", description: "Agenda a próxima reunião com data, horário e participantes confirmados." },
    ],
  },
  {
    key: "closer_discovery",
    name: "Discovery Closer",
    appliesTo: "closer",
    description: "Reunião de diagnóstico/fechamento: entender profundamente o cenário e conduzir para a decisão.",
    guidance: "Avalie como uma reunião de Closer. Diagnóstico antes da apresentação é essencial.",
    criteria: [
      opening,
      {
        key: "diagnostico",
        competency: "Diagnóstico",
        name: "Diagnóstico antes da solução",
        description: "Investiga cenário atual, problema, impacto e objetivos ANTES de apresentar a solução.",
        anchors: { "0": "Apresenta a solução sem investigar.", "5": "Investiga parcialmente e apresenta cedo.", "10": "Diagnóstico completo e só então apresenta, conectando à dor." },
        weight: 2.5,
        mandatory: true,
      },
      {
        key: "processo_decisao",
        competency: "Diagnóstico",
        name: "Processo de decisão",
        description: "Mapeia decisores, critérios de decisão, orçamento e prazo.",
        anchors: { "0": "Não pergunta como a decisão será tomada.", "5": "Identifica apenas o decisor ou o prazo.", "10": "Decisores, critérios, orçamento e prazo mapeados." },
        weight: 2,
      },
      {
        key: "apresentacao_valor",
        competency: "Proposta de valor",
        name: "Apresentação orientada a valor",
        description: "Apresenta a solução ligando cada ponto a uma dor ou objetivo dito pelo cliente.",
        anchors: { "0": "Lista funcionalidades genéricas.", "5": "Conecta alguns pontos às dores.", "10": "Cada ponto ligado a algo que o cliente disse, com impacto." },
        weight: 1.5,
        applicability: "Aplicável somente se houver apresentação da solução na conversa.",
      },
      objections,
      listening,
      nextSteps,
    ],
  },
  {
    key: "spin",
    name: "SPIN Selling",
    appliesTo: "any",
    description: "Perguntas de Situação, Problema, Implicação e Necessidade de solução.",
    guidance: "Avalie a qualidade e a sequência das perguntas SPIN. Excesso de perguntas de situação é ponto de atenção.",
    criteria: [
      { key: "spin_situacao", competency: "SPIN", name: "Perguntas de situação", description: "Coleta fatos do cenário atual de forma objetiva, sem excesso.", anchors: { "0": "Nenhuma ou excesso cansativo.", "5": "Adequadas mas pouco focadas.", "10": "Poucas, focadas e preparadas." }, weight: 1 },
      { key: "spin_problema", competency: "SPIN", name: "Perguntas de problema", description: "Explora dificuldades, insatisfações e problemas.", anchors: { "0": "Não explora problemas.", "5": "Identifica problemas superficiais.", "10": "Explora problemas relevantes em profundidade." }, weight: 1.5, mandatory: true },
      { key: "spin_implicacao", competency: "SPIN", name: "Perguntas de implicação", description: "Faz o cliente perceber consequências e custo do problema.", anchors: { "0": "Não explora consequências.", "5": "Uma implicação explorada.", "10": "Várias implicações com impacto quantificado pelo cliente." }, weight: 2 },
      { key: "spin_necessidade", competency: "SPIN", name: "Necessidade de solução", description: "Leva o cliente a verbalizar o valor de resolver o problema.", anchors: { "0": "Não ocorre.", "5": "O vendedor afirma o valor, não o cliente.", "10": "O cliente verbaliza o benefício de resolver." }, weight: 2 },
      nextSteps,
    ],
  },
  {
    key: "challenger",
    name: "Challenger Sale",
    appliesTo: "any",
    description: "Ensinar, adaptar e assumir o controle da conversa.",
    guidance: "Avalie se o vendedor traz uma perspectiva nova e conduz a conversa com segurança e respeito.",
    criteria: [
      { key: "ch_ensinar", competency: "Challenger", name: "Ensinar (insight)", description: "Traz um insight relevante que muda a forma como o cliente enxerga o problema.", anchors: { "0": "Sem insight.", "5": "Informação genérica do mercado.", "10": "Insight específico que reenquadra o problema do cliente." }, weight: 2, mandatory: true },
      { key: "ch_adaptar", competency: "Challenger", name: "Adaptar a mensagem", description: "Ajusta a mensagem ao papel e às prioridades do interlocutor.", anchors: { "0": "Discurso padrão.", "5": "Alguma adaptação.", "10": "Mensagem claramente adaptada ao interlocutor." }, weight: 1.5 },
      { key: "ch_controle", competency: "Challenger", name: "Assumir o controle", description: "Conduz com firmeza, inclusive em temas como preço e prazo, sem ser agressivo.", anchors: { "0": "Passivo ou agressivo.", "5": "Conduz parcialmente.", "10": "Conduz com segurança e mantém o foco." }, weight: 1.5 },
      objections,
      nextSteps,
    ],
  },
  {
    key: "consultative",
    name: "Venda consultiva",
    appliesTo: "any",
    description: "Entender profundamente o cliente e recomendar o que faz sentido para ele.",
    guidance: "Avalie postura de consultor: curiosidade genuína, recomendação personalizada e honestidade.",
    criteria: [
      opening,
      { key: "cons_descoberta", competency: "Descoberta", name: "Descoberta de necessidades", description: "Perguntas abertas sobre objetivos, desafios e contexto.", anchors: { "0": "Não faz descoberta.", "5": "Descoberta superficial.", "10": "Descoberta profunda e organizada." }, weight: 2, mandatory: true },
      listening,
      { key: "cons_recomendacao", competency: "Proposta de valor", name: "Recomendação personalizada", description: "Recomenda o que faz sentido com base no que foi descoberto.", anchors: { "0": "Oferta genérica.", "5": "Parcialmente personalizada.", "10": "Totalmente baseada no diagnóstico." }, weight: 1.5, applicability: "Aplicável somente se houver recomendação/proposta na conversa." },
      objections,
      nextSteps,
    ],
  },
];

export const DEFAULT_THRESHOLDS = [
  { label: "Excelente", minScore: 8.5 },
  { label: "Bom", minScore: 7 },
  { label: "Em desenvolvimento", minScore: 5 },
  { label: "Abaixo do esperado", minScore: 0 },
];
