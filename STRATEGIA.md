# Strategia e diario - Prova virtuale crypto
Ultimo aggiornamento: 2026-10-04

## Scopo
Strumento di segnali (compra / vendi / stop) su 9 monete: BTC, ETH, SOL, BNB, XRP, ADA, DOGE, LTC, LINK. Nessun ordine automatico.
Prova virtuale con 3000 di capitale finto dal 2026-10-03 (BTC, ETH, SOL). Le altre 6 monete valutate dalla candela del 2026-10-04.

## Strategia attuale (v3, trend-following, solo acquisto)
Dati: candele giornaliere Binance (monete contro USDT).
- Entrata: chiusura sopra il massimo delle chiusure dei 55 giorni precedenti E sopra la media a 200 giorni. Si compra all'apertura del giorno dopo.
- Uscita: chiusura sotto il minimo delle chiusure dei 20 giorni precedenti (si vende all'apertura del giorno dopo), oppure stop.
- Stop iniziale: entrata meno 3 volte l'ATR(14). Nessun target di guadagno fisso.
- Se piu monete danno segnale insieme: priorita a quella piu sopra la propria media a 200.

## Regole di bankroll
- Capitale 3000. Rischio 1% per trade (quantita = capitale x rischio / distanza dallo stop).
- Dopo 30 trade chiusi: un quarto di Kelly calcolato sui trade reali, tetto 2%.
- Rischio ridotto in proporzione al drawdown. Stop globale a -15% dal massimo: nessun nuovo acquisto per 30 giorni, poi si riparte.
- Massimo 2 posizioni aperte (anche con 9 monete: molti segnali resteranno non eseguiti), rischio totale aperto 2%, massimo 50% del capitale in una posizione.
- Costi: commissione 0,26% per operazione, slippage 0,05%.

## Test fatti (numeri copiati dagli screenshot)
| Test | Esito |
|---|---|
| v1 RSI<30 + supporto, 2 anni giornaliero | 3000 -> 2913,64 (-2,9%), 12 trade, vinti 33%, profit factor 0,54 |
| v2 RSI<40 + media 200, 2 anni giornaliero | +2,1%, 7 trade, vinti 43%, PF 1,57, drawdown 4,8% (compra-e-tieni medio +2,2%) |
| v2, 4 mesi su 4 ore | +5,0%, 14 trade, PF 1,75, drawdown 5,2% (compra-e-tieni medio +70,6%) |
| v2, storico 2017-2026 | 31 trade, circa -6% (somma dei risultati annui), criteri non superati |
| v3 trend-following, BTC+ETH+SOL, 2017-2026 | 3000 -> 5960 (+98,7%), 54 trade, vinti 53,7%, PF 4,65, drawdown 9,9% |
| v3 su 6 monete nuove (BNB, XRP, ADA, DOGE, LTC, LINK), 2017-2026 | 3000 -> 7066,91 (+135,6%), 67 trade, vinti 46,3%, PF 3,83, drawdown 11,9%. Criteri fissati prima: superati |

v3 su BTC/ETH/SOL per moneta: BTC 22 trade +1055,54 | ETH 21 trade +960,05 | SOL 11 trade +944,45.
v3 su BTC/ETH/SOL per anno (P&L): 2018 -27,64 | 2019 +230,40 | 2020 +157,61 | 2021 +1110,47 | 2022 -29,50 | 2023 +17,51 | 2024 +1493,44 | 2025 -203,86 | 2026 +211,61.
v3 su BTC/ETH/SOL: unico criterio fallito = rendimento/drawdown contro BTC tenuto fermo (9,95 contro 22,57). Circa l'88% del guadagno viene da 2021 e 2024.

Test sulle 6 monete nuove, ognuna da sola con 3000 (trade, PF, rendimento, drawdown strategia; compra-e-tieni e suo drawdown):
BNB 25, 13,37, +76%, 12%; tieni +49988% (dd 80%) | XRP 24, 2,23, +11%, 8%; tieni +67% (dd 85%) | ADA 20, 5,32, +38%, 6%; tieni 0% (dd 95%) | DOGE 19, 2,70, +10%, 9%; tieni +2298% (dd 92%) | LTC 24, 1,19, +2%, 9%; tieni -76% (dd 93%) | LINK 20, 2,35, +8%, 8%; tieni +2784% (dd 90%).
Portafoglio delle 6 per anno (P&L, trade): 2018 -15 (1) | 2019 +256 (5) | 2020 +309 (10) | 2021 +2058 (9) | 2022 -33 (4) | 2023 -14 (11) | 2024 +1295 (13) | 2025 -185 (10) | 2026 +396 (4).
Limiti: circa l'82% del guadagno viene da 2021 e 2024; BNB da solo pesa circa la meta dei risultati singoli; le monete non sono prove indipendenti (si muovono insieme); il test include solo monete ancora quotate (ottimismo da sopravvivenza). Rendimento del portafoglio circa 10% annuo composto sul passato.
Il portafoglio da 9 monete insieme (con il limite di 2 posizioni) NON e' mai stato provato come sistema unico.

## Criteri di valutazione (fissati prima dei test)
- Test su BTC/ETH/SOL: almeno 30 trade, profit factor >= 1,3, drawdown massimo <= 20%, rendimento > 0, e rendimento/drawdown migliore del compra-e-tieni su BTC.
- Test sulle 6 monete nuove: almeno 4 monete su 6 con P&L positivo, e portafoglio delle 6 con almeno 30 trade, PF >= 1,3, drawdown <= 20%, rendimento > 0 (nessun confronto con BTC).

## Regole del metodo
- Un solo tentativo per ogni idea. Nessun ritocco dei parametri dopo aver visto i risultati. Niente monete scelte o scartate a posteriori (LTC resta anche se vicino a zero).
- Durante la prova virtuale la strategia non cambia: ogni modifica azzera il conteggio dei trade.
- Ogni modifica va scritta qui sotto con data e motivo.

## Prova virtuale
- Gira ogni giorno alle 00:10 UTC su GitHub Actions. File: paper_trader.js, .github/workflows/paper.yml. Dati: paper_state.json e PAPER_RIEPILOGO.md. Pagina privata su Render (cartella web/).
- Valutazione con almeno 15-20 trade chiusi. Con 9 monete servono forse 1,5-2 anni. Prima di allora i risultati non dicono nulla.
- Soldi veri: non prima. Eventuale primo passo: 300-500 al massimo, chiave API solo per il trading e mai per i prelievi, verifica fiscale con il commercialista.

## Da fare
- Provare gli avvisi per mail (file test-notifica.yml, non ancora creato): le notifiche non sono mai state provate.
- Provare il portafoglio da 9 monete come sistema unico, per avere il riferimento di cosa aspettarsi.
- Rinnovare il token GitHub della pagina entro 2027-10-03.

## Diario
- 2026-10-04: provate 3 strategie sugli stessi dati. v1 e v2 (RSI) senza vantaggio, v3 (trend-following) supera 4 criteri su 5. Avviata prova virtuale automatica e pagina privata.
- 2026-10-04: test v3 su 6 monete nuove: criteri superati. Decisione: aggiunte le 6 monete alla prova virtuale (stato conservato, zero trade al momento del cambio) e alla pagina web.

## Come ripartire in una nuova chat
Incolla questo file e PAPER_RIEPILOGO.md. Se bisogna modificare il codice, incolla anche paper_trader.js.