# Protocol

Protocol uses P2PKH addresses. Actions are saved using __OP_RETURN.__

Message data is UTF-8 encoded. For example, this action would set your name to "memo":

### Prefix (Lokad Id)

`0x00802443`

### Examples

Deposit

```
OP_RETURN 0x00802443 6d656d6f

<prefix: 0x00802443> (4 bytes)
<action: 0x6d24> (2 bytes)
<input/output_1>
...
<input/output_n>
```

# Action Codes

User will use the following actions to perform operations against their pool accounts.

| Message Code | Name         | Description                                              |
| :----------: | :----------: | :------------------------------------------------------- |
| 0x01         | __Create__   | Requests a __NEW__ account to be created.                |
| 0x02         | __Deposit__  | Deposit funds into the specified pool account.           |
| 0x03         | __Withdraw__ | Withdraw funds from the specified pool account.          |
| 0x04         | __Transfer__ | Withdraw funds from the specified pool account.          |
| 0x05         | __Pay__      | Builds a payment _(of a specific amount)_ to be sent.    |

Additional actions being considered:

- Tagging users in posts
- Issue and revoke delegated addresses
- Dislike and/or flag posts/users

__Note:__ Actions that have not been implemented are subject to change.

### Create

User will request a NEW account address.

This address will be a re-usable payment address OR a stealth address.

| Byte Count | Name                   | Format/Values          | Description                       |
| :--------: | :--------------------- | :--------------------: | :-------------------------------- |
| 1          | Protocol version       | Version byte           | See protocol description.         |
| 1          | Create                 | 0x01                   | _Create_ message code. See above. |
| 33         | Initiator's public key | &lt;public_key&gt;     | Signing key for messages.         |
