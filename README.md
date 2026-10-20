# MusicPresence

Extensão para Firefox que mostra no Discord a música que você está ouvindo no YouTube Music, com capa, título, artista, etc.

## Sobre

Esse projeto foi feito em sua maior parte por IA pois eu só quero mostrar a musica que estou escutando no Discord.

## Como funciona

1. **`content.js`** roda na página do YouTube Music e lê título, artista, álbum, capa, playlist e estado de reprodução.
2. **`background.js`** recebe esses dados, aplica debounce e limite de frequência e decide quando atualizar o Discord.
3. **`native-host/ytmusic_discord_rpc.py`** mantém uma única conexão com o Discord e envia o `SET_ACTIVITY`. Se nada mudou, ele não toca no Discord.

O Firefox não consegue acessar o socket IPC do Discord diretamente, por isso existe o host em Python (Native Messaging).

## Requisitos

- Firefox 109 ou superior
- Discord desktop aberto
- Python 3
- Linux ou macOS (macOS ainda não foi testado)

## Instalação

1. Crie uma aplicação em <https://discord.com/developers/applications> e copie o **Application ID**
2. *(Opcional)* Em **Rich Presence → Art Assets**, envie imagens com os nomes `ytmusic` (capa reserva) e `youtube` (ícone pequeno).
3. Na pasta do projeto, rode:

   ```bash
   ./setup.sh
   ```

   Isso registra o host nativo no Firefox (`~/.mozilla/native-messaging-hosts/`).
4. No Firefox, abra `about:debugging#/runtime/this-firefox`, clique em **Carregar extensão temporária** e escolha o `manifest.json`.
5. Abra as configurações da extensão, cole o **Application ID** e salve.
6. Com o Discord aberto, **recarregue** a aba do `music.youtube.com` e toque uma música.

## Configurações

| Opção | Descrição |
| --- | --- |
| Application ID | ID da aplicação criada no Discord (obrigatório) |
| Asset grande | Imagem reserva, usada quando a capa não estiver disponível |
| Asset pequeno | Ícone pequeno no canto da capa |
| Mostrar Rich Presence | Liga e desliga o card |
| Mostrar playlist | Mostra o nome da playlist ao passar o mouse na capa |
| Idioma | Português ou English |

A página de **logs de diagnóstico** (botão nas configurações) mostra o que foi detectado e o que o host respondeu.

## Problemas comuns

1. "No such native application": Rode `./setup.sh` de novo e recarregue a extensão.
2. Popup não mostra a música: Recarregue a aba do YouTube Music depois de carregar ou recarregar a extensão
3. Extensão não faz nada na página: Em `about:addons` → a extensão → *Permissões*, permita `music.youtube.com`
4. Nome da playlist não aparece: É lido do painel da fila e depende do layout do site (veja abaixo)
5. Firefox via Flatpak ou Snap: Não consegue executar o host nativo fora do sandbox; use o Firefox convencional

## Privacidade

Nada sai do seu computador, exceto o que o próprio Discord recebe para montar o card. Nenhum áudio, cookie ou dado de conta é lido ou enviado.
