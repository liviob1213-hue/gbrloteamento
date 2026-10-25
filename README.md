# Grupo GBR — site institucional (MVP one-page)

Recriação da home do [grupogbrmg.com.br](https://grupogbrmg.com.br/) em HTML/CSS/JS puro,
com animações GSAP + ScrollTrigger e scroll suave (Lenis). Sem build, sem framework:
sobe em qualquer hospedagem estática (Hostinger, Vercel, Netlify, cPanel, S3...).

## Como rodar localmente

```bash
npx serve -l 5178 .
```

Depois abra `http://localhost:5178`. (Abrir o `index.html` direto pelo Explorer também
funciona, mas o `<iframe>` do Google Maps pode reclamar.)

## Estrutura

```
index.html            página inteira
css/style.css         design system + responsivo
js/main.js            GSAP, ScrollTrigger, menu, acordeão, formulário
assets/
  video/              ← COLOQUE AQUI o hero.mp4 (ver LEIA-ME.txt)
  img/brand/          logotipos Grupo GBR
  img/empreendimentos/ logomarcas dos empreendimentos
  img/icons/          as 12 etapas do processo
  img/social/         posts do Instagram
```

## O vídeo da hero

Coloque o arquivo em `assets/video/hero.mp4`. O site detecta sozinho:
enquanto o arquivo não existir, a hero exibe um fundo gradiente animado
(nada quebra). Detalhes e comando de compressão em `assets/video/LEIA-ME.txt`.

## Seções (todas com tópico + link, como no site atual)

| Seção | Link / CTA |
|---|---|
| Hero | `#empreendimentos` · `#grupo` |
| Destaque — Jardim das Gerais | https://loteamento-hero.lovable.app/ |
| Lançamentos (3 cards) | `/category/lancamento/` + link por card |
| Faixa — incorporação | `#parceiro` |
| O Grupo | `/quem-somos/` |
| Serviços (acordeão, 4 frentes) | `/servicos` |
| Empreendimentos (3 cards) | `/empreendimentos/` + link por card |
| Seja parceiro — 12 etapas do processo | `#contato` |
| Força de vendas | `/forca-de-vendas/` |
| Últimas unidades (3 cards) | `/category/ultimas-unidades/` + link por card |
| Redes sociais | Instagram @grupogbrmg |
| Fale conosco | formulário → WhatsApp, telefone, e-mail, mapa |

## O que foi removido

Toda referência à **Fort Estratégia Imobiliária**: o logotipo na seção
"Nossa força de vendas" e a menção no texto institucional. O texto do grupo agora
cita apenas **GBR Empreendimentos** e **GBR Serviços** — todo o resto do conteúdo
daquela seção (as 6 atribuições da força de vendas) foi mantido.

## Pontos para você conferir / ajustar

1. **Números da hero** (`index.html`, bloco `.hero__bar`): "15+ anos", "3 segmentos",
   "100% projetos legalizados". Confirme com o cliente antes de publicar.
2. **WhatsApp**: hoje aponta para `5531995100776` (número divulgado no Instagram deles).
   Está em dois lugares: no botão flutuante (`index.html`, `<a class="wa">`) e na
   constante `WA` em `js/main.js`.
3. **Formulário**: MVP sem backend — valida os campos e abre o WhatsApp com a mensagem
   pronta. Para enviar por e-mail, troque o `submit` por Formspree / API própria.
4. **Imagens dos empreendimentos**: as que o site atual tem são as *logomarcas*, não
   fotos. Por isso os cards usam fundo branco com a marca centralizada. Se o cliente
   enviar fotos reais, troque os arquivos em `assets/img/empreendimentos/` e remova a
   classe `card__media--logo` do card correspondente.
5. **Cor de destaque**: o dourado `--gold: #C2A24C` foi adicionado ao navy original
   (`#171E35` / `#1B203E`) para dar o ar premium. Está centralizado no `:root` do CSS.
