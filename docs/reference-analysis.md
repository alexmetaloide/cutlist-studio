# Análise da referência e escopo da reconstrução

Referência: https://www.cutlistoptimizer.com/ — observação em 16/10/2026.

## Evidências

Os identificadores abaixo são registros locais desta investigação, não IDs emitidos pela REA. O diagnóstico da REA 6.5.0 encontrou Node 25 incompatível com os requisitos da ferramenta, skill desatualizada e registro MCP indisponível. A análise foi continuada por leitura estática dos recursos públicos e observação no navegador. Nenhum mecanismo de autenticação foi contornado.

| ID | Fonte pública / observação | Conclusão e limites |
| --- | --- | --- |
| REF-01 | HTML da página inicial | Referências explícitas a AngularJS, Bootstrap 3.3.7, Angular UI Grid, d3, jsPDF e arquivos `js/*.min.js?v=1.12.1`. Essa é a versão indicada nas URLs, sem comprovação de uma versão de backend. |
| REF-02 | Página renderizada, desktop e celular | Barra superior escura, ação verde de cálculo, tabelas laterais de painéis e estoque, opções e área de resultado. Português detectado no navegador. |
| REF-03 | `js/cut-list-service.min.js` | Código ofuscado com entradas `POST`, `/tasks`, `getTaskStatus`, `stockPanels`, `panels`, `cutThickness`, `considerOrientation` e `forceServerSideCalc`. Indica orquestração de tarefas e configuração de cálculo; o corpo do algoritmo privado do servidor não está exposto. Não foram enviados trabalhos à API. |
| REF-04 | HTML e `js/app-controller.min.js` | Controles e referências para projetos, CSV, PDF, imagens, nomes, materiais, fitas de borda, unidades e direção do veio. Presença estática não comprova disponibilidade em todos os planos. |
| REF-05 | HTML, seção de estatísticas | Métricas de chapas, área usada, desperdício, número e extensão de cortes, painéis não encaixados e estatísticas por chapa. |
| REF-06 | Recursos first-party públicos | 61 arquivos HTML, JS, traduções e CSS, aproximadamente 943 KB, foram obtidos para estudo em `work/reference`, fora deste repositório. Não inclui o código do servidor nem todos os componentes de terceiros. |

## Decisões de implementação

- Implementação independente em módulos JavaScript, CSS e SVG, sem reutilizar o código ofuscado, logotipos ou recursos proprietários da referência.
- Estrutura visual e fluxo principal preservados, com identidade própria CutList Studio e controles explícitos de adicionar/excluir linhas.
- Cálculo local com portfólio de heurísticas de cortes guilhotinados. Não se afirma equivalência matemática com o motor do serviço.
- Projetos locais e JSON substituem contas e armazenamento remoto. Telas de assinatura e cobrança não se aplicam a esta implementação.
- PDF via impressão do navegador, PNG/SVG por chapa; impressão de todas as chapas com sequência de cortes.
- Refilo, unidades e limites documentados no README e na interface.

## Cobertura

| Pergunta | Resultado |
| --- | --- |
| Estrutura e controles da página pública | Respondida por HTML e observação. |
| Bibliotecas enviadas ao navegador | Respondida pelo inventário do HTML; não houve auditoria de cada dependência. |
| Fluxo das peças, estoque e opções | Respondida pela interface e reconstruída com implementação própria. |
| Resultado exato e desempenho comparado ao serviço | Não comparados. O serviço usa componentes privados e não foram enviados cálculos à API original. |
| Código completo do backend, autenticação e pagamentos | Indisponível no conteúdo público; não reconstruído. |
| Motor independente correto nos cenários cobertos | Verificado por testes de limites, materiais, rotação, kerf, refilo, sobreposição, conservação de área e sequência física de cortes. |

Esta entrega é uma reconstrução funcional do fluxo público principal, com diferenças de identidade visual, implementação e serviços. Não é uma cópia integral de todos os sistemas internos do site.
