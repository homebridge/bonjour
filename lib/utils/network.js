const os = require('os')

function resolveInterface (address) {
  let interfaceName

  outer: for (const [name, infoArray] of Object.entries(os.networkInterfaces())) {
    for (const info of infoArray) {
      if (info.address === address) {
        interfaceName = name
        break outer // exit out of both loops
      }
    }
  }

  return interfaceName
}

module.exports = {
  resolveInterface: resolveInterface
}
