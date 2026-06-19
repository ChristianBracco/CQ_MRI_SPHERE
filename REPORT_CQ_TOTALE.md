# Report CQ Totale - Sphere QC

## Obiettivo

L'applicazione `sphere_qc` ora puo' costruire un report CQ totale partendo dalle tre acquisizioni dello stesso giorno presenti nello storico.

Prima il report descriveva solo l'acquisizione corrente. Con questa modifica, ogni analisi completata viene salvata nello storico e il pulsante **Report CQ totale** raccoglie le acquisizioni salvate per la data selezionata.

## Flusso Operativo

1. Caricare la prima acquisizione DICOM.
2. Selezionare la slice e compilare le informazioni del controllo.
3. Eseguire l'analisi, preferibilmente con **Tutti**.
4. L'acquisizione viene salvata automaticamente nello storico.
5. Ripetere lo stesso flusso per la seconda e la terza acquisizione.
6. Tornare alla pagina Report e premere **Report CQ totale**.
7. L'app genera il riepilogo aggregato delle tre acquisizioni salvate per la data controllo.

## Dati Salvati Nello Storico

Ogni acquisizione viene salvata con:

- data del controllo;
- data acquisizione DICOM;
- risultati delle analisi;
- metadati DICOM;
- informazioni inserite dall'utente;
- serie attiva;
- slice selezionata;
- identificativo univoco dell'acquisizione.

Lo storico principale si trova in:

```text
sphere_qc/qc_history.json
```

Questo permette di aggregare acquisizioni anche quando provengono da cartelle DICOM diverse.

## Anti-Duplicazione

Ogni acquisizione ha un `acquisition_id` costruito a partire da:

- cartella DICOM;
- serie attiva;
- data studio;
- protocollo o descrizione serie;
- TR/TE;
- slice selezionata.

Se la stessa acquisizione viene rianalizzata, il record nello storico viene aggiornato invece di essere duplicato.

## Report CQ Totale

Il pulsante **Report CQ totale**:

- legge lo storico centrale;
- filtra le acquisizioni per la data controllo selezionata;
- prende fino alle ultime tre acquisizioni disponibili;
- mostra una tabella comparativa;
- calcola media e range dei parametri principali;
- segnala se sono presenti meno di tre acquisizioni.

I parametri aggregati sono:

- distorsione geometrica;
- PIU;
- PSG;
- SNR;
- SNRU;
- T2.

## Note

Il report corrente rimane disponibile e continua a descrivere l'acquisizione attiva.

Il report totale serve invece per il controllo complessivo giornaliero, quando tutte e tre le acquisizioni sono state analizzate e salvate nello storico.

