const TestUtil = require('./util')
const CheckUtil = require('./checkUtil')
const unit = require('ethjs-unit')
const ONEUtil = require('../lib/util')
const ONEDebugger = require('../lib/debug')
const ONE = require('../lib/onewallet')
const ONEConstants = require('../lib/constants')
const Flow = require('../lib/api/flow')
const ONEWallet = require('../lib/onewallet')
const crypto = require('crypto')
const BN = require('bn.js')
const { getIdentificationKey } = require('../lib/util')
const { wait } = require('./util')

const INTERVAL = 30000
const DURATION = INTERVAL * 12
const SLOT_SIZE = 1
const EFFECTIVE_TIME = Math.floor(Date.now() / INTERVAL / 6) * INTERVAL * 6 - DURATION / 2
const ONE_CENT = unit.toWei('0.01', 'ether')
// const HALF_DIME = unit.toWei('0.05', 'ether')
// const ONE_DIME = unit.toWei('0.1', 'ether')
const ONE_ETH = unit.toWei('1', 'ether')
const TEN_ETH = unit.toWei('10', 'ether')

const Logger = TestUtil.Logger
const Debugger = ONEDebugger(Logger)

contract('ONEWallet', (accounts) => {
  let snapshotId
  beforeEach(async function () {
    snapshotId = await TestUtil.snapshot()
    await TestUtil.init()
  })

  afterEach(async function () {
    await TestUtil.revert(snapshotId)
  })

  // Test creation and validation of wallet
  it('Wallet_Validate: must be able to create and validate a wallet', async () => {
    const alice = await CheckUtil.makeWallet('alice', accounts[0])
    await CheckUtil.checkONEWallet(alice.wallet, alice.state)
  })

  // Transfer Native Asset to external wallet
  it('Wallet_CommitReveal: Native Asset Transfer must commit and reveal successfully', async () => {
    // Create Wallets and fund
    const alice = await CheckUtil.makeWallet('alice', accounts[0])
    const bob = await CheckUtil.makeWallet('bob', accounts[0])
    const aliceInitialWalletBalance = await web3.eth.getBalance(alice.wallet.address)
    const bobInitialWalletBalance = await web3.eth.getBalance(bob.wallet.address)
    assert.equal(TEN_ETH, aliceInitialWalletBalance, 'Alice Wallet initially has correct balance')
    // alice tranfers ONE CENT to bob
    await CheckUtil.assetTransfer(
      {
        wallet: alice,
        operationType: ONEConstants.OperationType.TRANSFER,
        dest: bob.wallet.address,
        amount: (ONE_CENT / 2)
      }
    )
    const alicewalletBalance = await web3.eth.getBalance(alice.wallet.address)
    const bobwalletBalance = await web3.eth.getBalance(bob.wallet.address)
    assert.equal(parseInt(aliceInitialWalletBalance) - parseInt(ONE_CENT / 2), alicewalletBalance, 'Alice Wallet has correct balance')
    assert.equal(parseInt(bobInitialWalletBalance) + parseInt(ONE_CENT / 2), bobwalletBalance, 'Bob Wallet has correct balance')
    // Alice Items that have changed - nonce, spendingState, lastOperationTime, Commits
    assert.notStrictEqual(await alice.wallet.nonce, alice.state.nonce, 'alice wallet.nonce should have been changed')
    // alice.state.nonce = parseInt(alice.state.nonce) + 1
    alice.state.nonce = await alice.wallet.getNonce()
    // spendingState
    assert.notStrictEqual(await alice.wallet.getSpendingState(), alice.state.spendingState, 'alice spendingState should have been changed')
    alice.state.spendingState = await alice.wallet.getSpendingState()
    assert.equal(alice.state.spendingState.spentAmount, ONE_CENT / 2, 'alice wallet.spentAmount should have been changed')
    assert.notStrictEqual(alice.state.spendingState.lastSpendingInterval, 0, 'alice wallet.spentAmount should have been changed')
    // lastOperationTime
    assert.notStrictEqual(await alice.wallet.lastOperationTime(), alice.state.lastOperationTime, 'alice wallet.lastOperationTime should have been updated')
    alice.state.lastOperationTime = await alice.wallet.lastOperationTime()
    // commits
    assert.notDeepEqual(await alice.wallet.getAllCommits(), alice.state.allCommits, 'alice wallet.allCommits should have been updated')
    alice.state.allCommits = await alice.wallet.getAllCommits()
    // check alice
    await CheckUtil.checkONEWallet(alice.wallet, alice.state)
  })

  // ERC20 Token Testing (Transfer, Mint, Track, SpendingLimit)
  it('Wallet_CommitReveal: ERC20(Transfer, Mint, Track) must commit and reveal successfully', async () => {
    // Create Wallets and tokens
    const alice = await CheckUtil.makeWallet('alice', accounts[0])
    const bob = await CheckUtil.makeWallet('bob', accounts[0])
    const { testerc20 } = await CheckUtil.makeTokens(accounts[0])
    let aliceBalanceERC20
    let aliceWalletBalanceERC20
    let bobBalanceERC20
    let bobWalletBalanceERC20
    // transfer ERC20 tokens from accounts[0] (which owns the tokens) to alices wallet
    await testerc20.transfer(alice.wallet.address, 1000, { from: accounts[0] })
    aliceWalletBalanceERC20 = await testerc20.balanceOf(alice.wallet.address)
    assert.equal(1000, aliceWalletBalanceERC20, 'Transfer of 1000 ERC20 tokens to alice.wallet succesful')
    // alice transfers tokens to bob
    await CheckUtil.assetTransfer(
      {
        wallet: alice,
        operationType: ONEConstants.OperationType.TRANSFER_TOKEN,
        tokenType: ONEConstants.TokenType.ERC20,
        contractAddress: testerc20.address,
        dest: bob.wallet.address,
        amount: 100
      }
    )
    // check alice and bobs balance
    aliceBalanceERC20 = await testerc20.balanceOf(alice.wallet.address)
    aliceWalletBalanceERC20 = await alice.wallet.getBalance(ONEConstants.TokenType.ERC20, testerc20.address, 0)
    bobBalanceERC20 = await testerc20.balanceOf(bob.wallet.address)
    bobWalletBalanceERC20 = await bob.wallet.getBalance(ONEConstants.TokenType.ERC20, testerc20.address, 0)
    assert.equal(900, aliceBalanceERC20, 'Transfer of 100 ERC20 tokens from alice.wallet succesful')
    assert.equal(900, aliceWalletBalanceERC20, 'Transfer of 100 ERC20 tokens from alice.wallet succesful and wallet balance updated')
    assert.equal(100, bobBalanceERC20, 'Transfer of 100 ERC20 tokens to bob.wallet succesful')
    assert.equal(100, bobWalletBalanceERC20, 'Transfer of 100 ERC20 tokens to bob.wallet succesful and wallet balance updated')
    // Check OneWallet Items that have changed
    // Alice Items that have changed - nonce, lastOperationTime, Commits, trackedTokens
    assert.equal(await alice.wallet.getNonce(), alice.state.nonce + 1, 'alice wallet.nonce should have been changed')
    alice.state.nonce = await alice.wallet.getNonce()
    assert.equal((await alice.wallet.getNonce()).toNumber(), alice.state.nonce, 'alice wallet.nonce should have been changed')
    // lastOperationTime
    assert.notEqual(await alice.wallet.lastOperationTime(), alice.state.lastOperationTime, 'alice wallet.lastOperationTime should have been updated')
    alice.state.lastOperationTime = new BN(await alice.wallet.lastOperationTime())
    assert.equal(new BN(await alice.wallet.lastOperationTime()), alice.state.lastOperationTime, 'alice wallet.lastOperationTime should have been updated')
    // commits
    let allCommits = await alice.wallet.getAllCommits()
    assert.notDeepEqual(await alice.wallet.getAllCommits(), alice.state.allCommits, 'alice wallet.allCommits should have been updated')
    console.log(`allCommits: ${JSON.stringify(allCommits)}`)
    console.log(`alice.state.allCommits: ${JSON.stringify(alice.state.allCommits)}`)
    alice.state.allCommits = await alice.wallet.getAllCommits()
    assert.deepEqual(await alice.wallet.getAllCommits(), alice.state.allCommits, 'alice wallet.allCommits should have been updated')
    // tracked tokens
    assert.notDeepEqual(await alice.wallet.getTrackedTokens(), alice.state.trackedTokens, 'alice.wallet.trackedTokens should have been updated')
    alice.state.trackedTokens = await alice.wallet.getTrackedTokens()
    assert.deepEqual(await alice.wallet.getTrackedTokens(), alice.state.trackedTokens, 'alice.wallet.trackedTokens should have been updated')
    await CheckUtil.checkONEWallet(alice.wallet, alice.state)
    // Bob Items that have changed - nothing
    await CheckUtil.checkONEWallet(bob.wallet, bob.state)
  })

  // ERC721 Testing (Transfer, Mint, Track)
  it('Wallet_CommitReveal: ERC721(Transfer, Mint, Track) must commit and reveal successfully', async () => {
    // Create Wallets and tokens
    const alice = await CheckUtil.makeWallet('alice', accounts[0])
    const aliceInitialWalletBalance = await web3.eth.getBalance(alice.wallet.address)
    assert.equal(TEN_ETH, aliceInitialWalletBalance, 'Alice Wallet initially has correct balance')
    const bob = await CheckUtil.makeWallet('bob', accounts[0])
    const { testerc721 } = await CheckUtil.makeTokens(accounts[0])
    let aliceWalletBalanceERC721
    let bobWalletBalanceERC721
    assert.equal(accounts[0], await testerc721.ownerOf(8), 'Alice.lastResortAddress owns token 8')
    // transfer ERC721 tokens from accounts[0] (which owns the tokens) to alices wallet
    await testerc721.transferFrom(accounts[0], alice.wallet.address, 8, { from: accounts[0] })
    aliceWalletBalanceERC721 = await testerc721.balanceOf(alice.wallet.address)
    await testerc721.transferFrom(accounts[0], alice.wallet.address, 9, { from: accounts[0] })
    aliceWalletBalanceERC721 = await testerc721.balanceOf(alice.wallet.address)
    assert.equal(2, aliceWalletBalanceERC721, 'Transfer of 2 ERC721 token to alice.wallet succesful')
    assert.equal(alice.wallet.address, await testerc721.ownerOf(8), 'Transfer of ERC721 token 8 to alice.wallet succesful')
    assert.equal(alice.wallet.address, await testerc721.ownerOf(9), 'Transfer of ERC721 token 9 to alice.wallet succesful')
    // console.log(`alice.wallet.getTrackedTokens(): ${JSON.stringify(await alice.wallet.getTrackedTokens())}`)
    // alice transfers tokens to bob
    await CheckUtil.assetTransfer(
      {
        wallet: alice,
        operationType: ONEConstants.OperationType.TRANSFER_TOKEN,
        tokenType: ONEConstants.TokenType.ERC721,
        contractAddress: testerc721.address,
        tokenId: 8,
        dest: bob.wallet.address,
      }
    )
    // check alice and bobs balance
    aliceWalletBalanceERC721 = await testerc721.balanceOf(alice.wallet.address)
    bobWalletBalanceERC721 = await testerc721.balanceOf(bob.wallet.address)
    assert.equal(1, aliceWalletBalanceERC721, 'Transfer of 1 ERC721 token from alice.wallet succesful')
    assert.equal(1, bobWalletBalanceERC721, 'Transfer of 1 ERC721 token to bob.wallet succesful')
    assert.equal(bob.wallet.address, await testerc721.ownerOf(8), 'Transfer of ERC721 token 8 to bob.wallet succesful')
    // Alice Items that have changed - nonce, lastOperationTime, Commits, trackedTokens
    assert.equal(await alice.wallet.getNonce(), alice.state.nonce + 1, 'alice wallet.nonce should have been changed')
    alice.state.nonce = await alice.wallet.getNonce()
    assert.equal((await alice.wallet.getNonce()).toNumber(), alice.state.nonce, 'alice wallet.nonce should have been changed')
    // lastOperationTime
    assert.notEqual(await alice.wallet.lastOperationTime(), alice.state.lastOperationTime, 'alice wallet.lastOperationTime should have been updated')
    alice.state.lastOperationTime = new BN(await alice.wallet.lastOperationTime())
    assert.equal(new BN(await alice.wallet.lastOperationTime()), alice.state.lastOperationTime, 'alice wallet.lastOperationTime should have been updated')
    // commits
    let allCommits = await alice.wallet.getAllCommits()
    assert.notDeepEqual(await alice.wallet.getAllCommits(), alice.state.allCommits, 'alice wallet.allCommits should have been updated')
    console.log(`allCommits: ${JSON.stringify(allCommits)}`)
    console.log(`alice.state.allCommits: ${JSON.stringify(alice.state.allCommits)}`)
    alice.state.allCommits = await alice.wallet.getAllCommits()
    assert.deepEqual(await alice.wallet.getAllCommits(), alice.state.allCommits, 'alice wallet.allCommits should have been updated')
    // tracked tokens
    assert.notDeepEqual(await alice.wallet.getTrackedTokens(), alice.state.trackedTokens, 'alice.wallet.trackedTokens should have been updated')
    alice.state.trackedTokens = await alice.wallet.getTrackedTokens()
    assert.deepEqual(await alice.wallet.getTrackedTokens(), alice.state.trackedTokens, 'alice.wallet.trackedTokens should have been updated')
    await CheckUtil.checkONEWallet(alice.wallet, alice.state)
    // Bob Items that have changed - tracked Tokens
    // console.log(`bob.wallet.getTrackedTokens(): ${JSON.stringify(await bob.wallet.getTrackedTokens())}`)
    // console.log(`bob.state.trackedTokens: ${JSON.stringify(bob.state.trackedTokens)}`)
    assert.notDeepEqual(await bob.wallet.getTrackedTokens(), bob.state.trackedTokens, 'alice.wallet.trackedTokens should have been updated')
    bob.state.trackedTokens = await bob.wallet.getTrackedTokens()
    await CheckUtil.checkONEWallet(bob.wallet, bob.state)
  })

  // ERC1155 Testing (Transfer, Mint, Track)
  it('Wallet_CommitReveal: ERC1155(Transfer, Mint, Track) must commit and reveal successfully', async () => {
    const alice = await CheckUtil.makeWallet('alice', accounts[0])
    const aliceInitialWalletBalance = await web3.eth.getBalance(alice.wallet.address)
    assert.equal(TEN_ETH, aliceInitialWalletBalance, 'Alice Wallet initially has correct balance')
    const bob = await CheckUtil.makeWallet('bob', accounts[0])
    const { testerc1155 } = await CheckUtil.makeTokens(accounts[0])
    let aliceWalletBalanceERC1155T8
    let bobWalletBalanceERC1155T8
    assert.equal(20, await testerc1155.balanceOf(accounts[0], 8), 'Alice.lastResortAddress owns 20 of token 8')
    // transfer ERC1155 tokens from accounts[0] (which owns the tokens) to alices wallet
    // TODO review the bytes value we are passing in safeTransferFrom (currently using ONEUtil.hexStringToBytes('5') )
    await testerc1155.safeTransferFrom(accounts[0], alice.wallet.address, 8, 8, ONEUtil.hexStringToBytes('5'), { from: accounts[0] })
    aliceWalletBalanceERC1155T8 = await testerc1155.balanceOf(alice.wallet.address, 8)
    assert.equal(8, aliceWalletBalanceERC1155T8, 'Transfer of 8 ERC721 token to alice.wallet succesful')
    // alice transfers tokens to bob
    await CheckUtil.assetTransfer(
      {
        wallet: alice,
        operationType: ONEConstants.OperationType.TRANSFER_TOKEN,
        tokenType: ONEConstants.TokenType.ERC1155,
        contractAddress: testerc1155.address,
        tokenId: 8,
        dest: bob.wallet.address,
        amount: 3
      }
    )
    // check alice and bobs balance
    aliceWalletBalanceERC1155T8 = await testerc1155.balanceOf(alice.wallet.address, 8)
    bobWalletBalanceERC1155T8 = await testerc1155.balanceOf(bob.wallet.address, 8)
    assert.equal(5, aliceWalletBalanceERC1155T8, 'Transfer of 3 ERC1155 tokens from alice.wallet succesful')
    assert.equal(3, bobWalletBalanceERC1155T8, 'Transfer of 3 ERC1155 token to bob.wallet succesful')
    // Alice Items that have changed - nonce, lastOperationTime, Commits, trackedTokens
    assert.equal(await alice.wallet.getNonce(), alice.state.nonce + 1, 'alice wallet.nonce should have been changed')
    alice.state.nonce = await alice.wallet.getNonce()
    assert.equal((await alice.wallet.getNonce()).toNumber(), alice.state.nonce, 'alice wallet.nonce should have been changed')
    // lastOperationTime
    assert.notEqual(await alice.wallet.lastOperationTime(), alice.state.lastOperationTime, 'alice wallet.lastOperationTime should have been updated')
    alice.state.lastOperationTime = new BN(await alice.wallet.lastOperationTime())
    assert.equal(new BN(await alice.wallet.lastOperationTime()), alice.state.lastOperationTime, 'alice wallet.lastOperationTime should have been updated')
    // commits
    let allCommits = await alice.wallet.getAllCommits()
    assert.notDeepEqual(await alice.wallet.getAllCommits(), alice.state.allCommits, 'alice wallet.allCommits should have been updated')
    console.log(`allCommits: ${JSON.stringify(allCommits)}`)
    console.log(`alice.state.allCommits: ${JSON.stringify(alice.state.allCommits)}`)
    alice.state.allCommits = await alice.wallet.getAllCommits()
    assert.deepEqual(await alice.wallet.getAllCommits(), alice.state.allCommits, 'alice wallet.allCommits should have been updated')
    // tracked tokens
    assert.notDeepEqual(await alice.wallet.getTrackedTokens(), alice.state.trackedTokens, 'alice.wallet.trackedTokens should have been updated')
    alice.state.trackedTokens = await alice.wallet.getTrackedTokens()
    assert.deepEqual(await alice.wallet.getTrackedTokens(), alice.state.trackedTokens, 'alice.wallet.trackedTokens should have been updated')
    await CheckUtil.checkONEWallet(alice.wallet, alice.state)
    // Bob Items that have changed - tracked Tokens
    // console.log(`bob.wallet.getTrackedTokens(): ${JSON.stringify(await bob.wallet.getTrackedTokens())}`)
    // console.log(`bob.state.trackedTokens: ${JSON.stringify(bob.state.trackedTokens)}`)
    assert.notDeepEqual(await bob.wallet.getTrackedTokens(), bob.state.trackedTokens, 'alice.wallet.trackedTokens should have been updated')
    bob.state.trackedTokens = await bob.wallet.getTrackedTokens()
    await CheckUtil.checkONEWallet(bob.wallet, bob.state)
  })

  // TokenTracker Testing (track, multitrack, getTrackedTokens, getBalance, recoverToken) also batch transactions
  it('Wallet_CommitReveal: TokenTracker(token management) must commit and reveal successfully', async () => {
    // let testTime = Date.now()
    const alice = await CheckUtil.makeWallet('alice', accounts[0])
    const bob = await CheckUtil.makeWallet('bob', accounts[0])
    const { testerc20, testerc721, testerc1155 } = await CheckUtil.makeTokens(accounts[0])
    // transfer ERC20 tokens from accounts[0] (which owns the tokens) to alices wallet
    await testerc20.transfer(alice.wallet.address, 1000, { from: accounts[0] })
    // alice transfers tokens to bob
    // testTime = TestUtil.bumpTestTime(testTime, 45)
    // await TestUtil.wait(45)
    await CheckUtil.assetTransfer(
      {
        wallet: alice,
        operationType: ONEConstants.OperationType.TRANSFER_TOKEN,
        tokenType: ONEConstants.TokenType.ERC20,
        contractAddress: testerc20.address,
        dest: bob.wallet.address,
        amount: 100
        // testTime
      }
    )
    await CheckUtil.checkONEWallet(alice.wallet, alice.state)
    // transfer ERC721 tokens from accounts[0] (which owns the tokens) to alices wallet
    await testerc721.transferFrom(accounts[0], alice.wallet.address, 8, { from: accounts[0] })
    // await TestUtil.getReceipt(tx.receipt.transactionHash)
    assert.equal(alice.wallet.address, await testerc721.ownerOf(8), 'Transfer of ERC721 token 8 to alice.wallet succesful')
    // alice transfers tokens to bob
    // testTime = TestUtil.bumpTestTime(testTime, 45)
    await TestUtil.wait(45)
    await CheckUtil.assetTransfer(
      {
        wallet: alice,
        operationType: ONEConstants.OperationType.TRANSFER_TOKEN,
        tokenType: ONEConstants.TokenType.ERC721,
        contractAddress: testerc721.address,
        tokenId: 8,
        dest: bob.wallet.address
        // testTime
      }
    )
    await CheckUtil.checkONEWallet(alice.wallet, alice.state)
    // transfer ERC721 tokens from accounts[0] (which owns the tokens) to alices wallet
    // TODO review the bytes value we are passing in safeTransferFrom (currently using ONEUtil.hexStringToBytes('5') )
    await testerc1155.safeTransferFrom(accounts[0], alice.wallet.address, 8, 8, ONEUtil.hexStringToBytes('5'), { from: accounts[0] })
    // alice transfers tokens to bob
    // testTime = TestUtil.bumpTestTime(testTime, 45)
    await TestUtil.wait(45)
    await CheckUtil.assetTransfer(
      {
        wallet: alice,
        operationType: ONEConstants.OperationType.TRANSFER_TOKEN,
        tokenType: ONEConstants.TokenType.ERC1155,
        contractAddress: testerc1155.address,
        tokenId: 8,
        dest: bob.wallet.address,
        amount: 3
        // testTime
      }
    )
    await CheckUtil.checkONEWallet(alice.wallet, alice.state)
  })
})
