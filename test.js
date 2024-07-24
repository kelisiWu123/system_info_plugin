var dictionary = require('dictionary-en')
var nspell = require('nspell')

dictionary(ondictionary)

function ondictionary(err, dict) {
    if (err) {
        throw err
    }

    var spell = nspell(dict)

    console.log(spell.correct('colour')) // => false
    console.log(spell.suggest('colour')) // => ['color']
    console.log(spell.correct('color')) // => true
    console.log(spell.correct('npm')) // => false
    spell.add('npm')
    console.log(spell.correct('npm')) // => true
}