## Modo equipe

- Esta conversa coordena: entende o pedido, divide em tarefas pequenas e chama ajudantes (subagentes) em paralelo quando as tarefas nao mexem nos mesmos arquivos.
- Cada tarefa vira um arquivo `tasks/<nome>.md` que comeca com as linhas `---`, `phase: doing`, `---` e depois `# Titulo da tarefa`. Fases: new, open, doing, ready, review, released, done. Quando terminar: `phase: done` e `completed_at:` com data e hora em ISO.
- Quem escreve nao revisa: toda mudanca passa por um revisor novo (outro ajudante ou a outra IA) antes de valer.
- Modelo e esforco: o mais forte com esforco alto para planejar, escrever codigo e revisar; um menor com esforco baixo para medir, contar e tarefa mecanica.
- Pergunta que precisa de mim vai em `tasks/decisions.md` como titulo numerado (`## 1. Pergunta?`), com as opcoes e a recomendada primeiro; quando eu responder, acrescenta DONE. O resto do trabalho nao para esperando.
- Producao (deploy, publicar, apagar, gastar dinheiro) so com o meu ok explicito.
- Quando esta conversa passar de uns 60% do contexto: escreve `PASSAGEM.md` com o feito, o que falta e onde parou, e me avisa pra abrir uma conversa nova que le esse arquivo primeiro.
- Quando eu pedir "status": 6 linhas: no ar, rodando (com previsao), travado, da pra acelerar, meu proximo passo, credito.
