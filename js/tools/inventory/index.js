// 📦 Inventory tool: track stuff around the house.
import * as D from './data.js';
import * as L from '../../core/locations.js';
import { renderList, renderItem, renderPlace, renderPlaces } from './views.js';
import { renderAdd } from './add.js';
import { renderLabels } from './labels.js';
import { downloadCsv, csvDate } from '../../core/csv.js';

const COLUMNS = [
  ['Name', (i) => i.name], ['Brand', (i) => i.brand], ['Category', (i) => i.category], ['Quantity', (i) => i.quantity ?? 1],
  ['Value each', (i) => i.value], ['Room', (i) => L.locationParts(i.location).room], ['Area', (i) => L.locationParts(i.location).area],
  ['Shelf/box', (i) => L.locationParts(i.location).spot], ['Owner', (i) => i.owner], ['Condition', (i) => i.condition],
  ['Lent to', (i) => i.lentTo], ['Lent date', (i) => (i.lentTo ? i.lentDate : '')], ['Barcode', (i) => i.barcode],
  ['Date added', (i) => csvDate(i.createdAt)], ['Notes', (i) => i.notes],
];

export default {
  routes: { '': renderList, add: renderAdd, item: renderItem, place: renderPlace, places: renderPlaces, labels: renderLabels },
  nav: [
    { route: '', label: 'Items', icon: 'box', match: ['', 'item'] },
    { route: 'places', label: 'Places', icon: 'pin', match: ['places', 'place'] },
    { route: 'add', label: 'Add / scan', icon: 'qr', primary: true },
    { route: 'labels', label: 'Labels', icon: 'print' },
  ],
  exports: [{ label: 'Inventory items (CSV)', run: () => downloadCsv('inventory', COLUMNS, D.items().sort((a, b) => a.name.localeCompare(b.name))) }],
};
