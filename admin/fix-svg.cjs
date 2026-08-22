const fs = require('fs');
let content = fs.readFileSync('images/qranty .svg', 'utf8');

content = content.replace(
  '<mask id="c5006ea789"><g filter="url(#d57f51158b)"><g filter="url(#178f9c849c)"',
  '<mask id="c5006ea789"><g filter="url(#178f9c849c)"'
);

content = content.replace(
  'meet"/></g></g></mask>',
  'meet"/></g></mask>'
);

content = content.replace(
  '</defs><g mask="url(#c5006ea789)">',
  '</defs><g filter="url(#d57f51158b)" mask="url(#c5006ea789)">'
);

fs.writeFileSync('images/qranty .svg', content);
console.log("Success");
