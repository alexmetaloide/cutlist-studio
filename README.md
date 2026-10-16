# CutList Studio

Planejador independente de cortes de chapas inspirado no fluxo do [CutList Optimizer](https://www.cutlistoptimizer.com). Interface em português e motor de otimização próprio. Não é o código original do serviço e não possui vínculo com ele.

## Executar

Requer Node.js 22 ou superior. Não há dependências para instalar.

```sh
npm start
```

Abra `http://127.0.0.1:4173`. Clique em **Experimentar com um exemplo** para gerar um primeiro plano. Para mudar a porta, defina a variável de ambiente `PORT`.

```sh
npm test
npm run build
node scripts/serve.js --dist
```

O build gera `dist/`, pronto para qualquer hospedagem estática. Use um servidor HTTP: abrir `index.html` diretamente como `file://` não permite carregar os módulos e o Web Worker.

## Publicar no GitHub Pages

O workflow `.github/workflows/pages.yml` testa o projeto, gera `dist/` e publica somente os arquivos do aplicativo. Em **Settings → Pages**, selecione **GitHub Actions** como origem. Após habilitar o Pages, execute **Publish GitHub Pages** em **Actions**, ou envie um novo commit à `main`. A publicação será atualizada automaticamente nos próximos envios.

O endereço padrão deste repositório é `https://alexmetaloide.github.io/cutlist-studio/`. Ele só fica disponível após o Pages ser habilitado e o deploy terminar. O plano da conta precisa permitir Pages para a visibilidade escolhida; na configuração atual da conta, repositórios privados não são elegíveis.

## Recursos

- Tabelas de peças e estoque com dimensões, quantidades, nomes, materiais e ativação por linha.
- Otimização 2D por cortes guilhotinados, executada em Web Worker para manter a interface responsiva.
- Espessura da serra, refilo, rotação, direção de veio, separação por material e limite de uma chapa.
- Fitas de borda por lado, indicação visual e soma do comprimento das fitas.
- Diagrama SVG com nomes, dimensões, seleção de peças, zoom e navegação entre chapas.
- Aproveitamento, áreas, peças não encaixadas, número e comprimento de cortes.
- Sequência de cortes com coordenadas, partindo do canto superior esquerdo.
- Projetos salvos no navegador e importação/exportação de JSON.
- Importação de peças e chapas por CSV ou texto colado; exportação CSV das peças.
- Exportação SVG e PNG da chapa selecionada; impressão de todas as chapas e da lista de cortes. Para PDF, escolha **Salvar como PDF** na impressão do navegador.
- Todas as medidas lineares em centímetros e áreas em cm², com conversão automática dos projetos antigos em milímetros ou polegadas.
- Layout responsivo para desktop e celular, sem serviços externos em tempo de execução.

## CSV

```csv
comprimento;largura;quantidade;nome;material
72;45;2;Lateral;MDF 1,8 cm
56,4;42;3;Prateleira;MDF 1,8 cm
```

Aceita ponto e vírgula, vírgula e tabulação; cabeçalhos em português ou inglês; decimais com vírgula quando o separador for ponto e vírgula; campos entre aspas. As dimensões do CSV são interpretadas em centímetros. As linhas importadas são adicionadas à lista. O nome é ignorado para estoque. Quantidades devem ser inteiros positivos.

## Como funciona o motor

`src/optimizer.js` exporta `optimize(project)`. A dimensão `length` fica no eixo X e `width` no eixo Y. As posições de saída usam `x`, `y`, `width` e `height`. O motor compara ordens de peças, estratégias de subdivisão e seleção de chapas. Primeiro busca encaixar a maior quantidade de peças; depois compara área e a prioridade escolhida. É uma heurística e não garante o ótimo matemático.

Cada corte atravessa um retângulo disponível inteiro, produzindo subdivisões que podem ser cortadas na sequência indicada. A espessura da serra é consumida à direita de cortes verticais e abaixo de cortes horizontais. Não é adicionada uma espessura desnecessária quando uma peça ocupa exatamente uma dimensão da região. O refilo reserva uma margem em cada lado; **os cortes de refilo devem ser realizados antes e não entram na sequência nem nas estatísticas de corte**.

O aproveitamento considera a área total das chapas abertas. A área não utilizada inclui sobras, refilo e material removido pela serra. Materiais são comparados pelo texto exato. A opção de veio bloqueia a rotação em 90°; cadastre comprimento e largura de acordo com o veio desejado. Fitas de borda são informativas, sem desconto nas dimensões. Limite de 2.000 peças e 2.000 chapas expandidas; 2 MB por arquivo importado.

## Dados e limites de equivalência

Os projetos ficam no `localStorage` do navegador. Projetos JSON e rascunhos antigos em milímetros ou polegadas são convertidos automaticamente para centímetros ao abrir, preservando as dimensões físicas. Os valores da serra e do refilo também são convertidos. Não há conta, sincronização em nuvem, assinatura ou cobrança. Exportar JSON permite backup e transferência. A interface e o comportamento principal foram reconstruídos com código próprio; telas comerciais, autenticação e o algoritmo privado do servidor original não foram copiados.

Consulte [a análise da referência](docs/reference-analysis.md) para fontes, cobertura e limitações. A suíte inclui casos aleatórios reprodutíveis, verificação de área e reprodução física da sequência de cortes.

## Estrutura

```text
index.html            Interface
src/app.js            Eventos, projetos, diagramas e exportações
src/style.css         Layout, responsividade e impressão
src/io.js             Validação JSON, CSV e unidades
src/optimizer.js      Motor de cortes independente
src/worker.js         Execução do motor fora da thread de interface
scripts/              Servidor HTTP e build estático
tests/                Testes com node:test
docs/                 Análise e limites da reconstrução
```
