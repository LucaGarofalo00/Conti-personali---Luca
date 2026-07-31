// Fuso orario FISSO per l'intera suite.
//
// FinanzApp ragiona su date locali (periodo ancorato allo stipendio, occorrenze settimanali,
// scadenze "oggi"), e mezza logica di utils.ts esiste proprio per NON passare da UTC. Se i test
// girano nel fuso della macchina, il loro esito cambia da computer a computer: sul portatile
// (Europe/Rome, +1/+2) passano, sul runner di GitHub Actions — che gira in UTC, dove ora locale e
// UTC coincidono — no. È esattamente il caso che ha rotto la CI.
//
// Pinnandolo qui la suite verifica sempre lo stesso scenario, ed è lo scenario reale d'uso:
// un fuso con scarto da UTC e con cambio ora legale.
process.env.TZ = 'Europe/Rome'
