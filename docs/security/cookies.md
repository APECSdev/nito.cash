# Cookies

Browser cookies are being used for ALL __[\*.]nito.cash__ domains, with the exception of __local.nito.cash,__ which uses localStorage.

The use of cookies enables the ability to share wallets across domains; something that is __NOT__ possible using localStorage _(an intentional design restriction)._

> __NOTE:__ Cookies have a data limit of __4 KiB;__ which is very small compared to __5 MiB__ available using localStorage.

### Local storage edition

__https://local.nito.cash__

> __Latest stable release,__ served over the Cloudflare IPFS gateway (https://cloudflare-ipfs.com).

For some users, it may be advantageous to use localStorage over cookies:

- Privacy concerns
- Security concerns
- GDPR restrictions
