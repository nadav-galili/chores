---
status: accepted
---
# Parents authenticate with Clerk; children are rows in our database with device-bound tokens

Children have no email or phone, COPPA pushes us to keep child data minimal and in-house, and Clerk bills per monthly active user while children will be the most active users. So parents are Clerk users and children exist only in Postgres. A parent issues a single-use join code for one child; the kid device redeems it and receives a long-lived token scoped to that household and child. The token scope is what gives sibling isolation: a device cannot address another child's rows. Do not "improve" this by putting children in an identity provider.
