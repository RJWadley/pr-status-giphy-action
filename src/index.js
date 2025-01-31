/* eslint no-console: 0 */
const axios = require('axios')

const NEUTRAL_ERROR_CODE = process.env.GITHUB_WORKFLOW ? 78 : 0

const githubEventPath = process.env.GITHUB_EVENT_PATH || ''
const githubEvent = githubEventPath ? require(githubEventPath) : ''
const githubAction = process.env.GITHUB_ACTION || ''
const githubRepo = process.env.GITHUB_REPOSITORY || ''
const githubSha = process.env.GITHUB_SHA || ''
const githubToken = process.env.GITHUB_TOKEN || ''
const githubApiVersion = 'v3'
const githubRepoUri = `https://api.github.com/repos/${githubRepo}`
const githubCheckRunsUri = `${githubRepoUri}/commits/${githubSha}/check-runs`
const githubPrCommentsUri = `${githubRepoUri}/issues/${
  githubEvent.number
}/comments`
const githubAcceptHeader = `application/vnd.github.${githubApiVersion}+json; application/vnd.github.antiope-preview+json`
const githubAuthHeader = `token ${githubToken}`
const githubApiHeaders = {
  Accept: githubAcceptHeader,
  Authorization: githubAuthHeader
}

const giphyApiKey = process.env.GIPHY_API_KEY || ''
const giphyRandomGifUri = 'https://api.giphy.com/v1/gifs/random'

const commentFooter =
  '<sub>;)</sub>'

/**
 * @return {Promise} Promise representing an HTTP GET to the check-runs endpoint
 */
function fetchChecks () {
  return axios.get(githubCheckRunsUri, {
    headers: githubApiHeaders
  })
}

/**
 * @return {string} Aggregate status of all checks -- one of 'FAILURE', 'IN_PROGRESS', or 'SUCCESS'
 */
function getStatusOfChecks ({ data }) {
  const filteredChecks = data.check_runs.filter(cr => cr.name !== githubAction)
  const failedChecks = filteredChecks.filter(
    cr => cr.status === 'completed' && cr.conclusion === 'failure'
  )
  if (failedChecks.length) return 'FAILURE'

  const inProgressChecks = filteredChecks.filter(
    cr => cr.status === 'queued' || cr.status === 'in_progress'
  )
  if (inProgressChecks.length) return 'IN_PROGRESS'
  return 'SUCCESS'
}

/**
 * @return {Promise} Promise representing the comments on the pull request.
 */
function getIssueComments () {
  return axios
    .get(githubPrCommentsUri, {
      headers: githubApiHeaders
    })
    .then(res => res.data)
}

/**
 * @param {any} comment an object representing a Github comment
 * @return {Promise} Promise representing the HTTP DELETE of a comment.
 */
function deleteComment (comment) {
  return axios.delete(`${githubRepoUri}/issues/comments/${comment.id}`, {
    headers: githubApiHeaders
  })
}

/**
 * @param {Array} comments an array of Github comment objects
 * @return {Promise} Promise representing the deletion of all comments previously left by this action.
 */
function deleteCommentsFromAction (comments) {
  const filteredComments = comments.filter(comment =>
    comment.body.includes(commentFooter)
  )

  if (!filteredComments.length) return Promise.resolve()

  console.log(
    `Found ${filteredComments.length} existing comment(s). Deleting...`
  )

  return Promise.all(filteredComments.map(deleteComment))
}

/**
 * @return {Promise} Promise representing the deletion of existing comments left by this action on a Pull Request.
 */
function deleteExistingComments () {
  return getIssueComments().then(deleteCommentsFromAction)
}

/**
 * @param {string} giphyTag the tag to use to search giphy
 * @return {Promise} Promise representing a gif from giphy
 */
function getGiphyGifForTag (giphyTag) {
  return axios
    .get(giphyRandomGifUri, {
      params: {
        tag: giphyTag,
        rating: 'pg-13',
        fmt: 'json',
        api_key: giphyApiKey
      }
    })
    .then(giphyRes => giphyRes.data.data)
}

/**
 * @param {any} gif an object representing a gif from giphy
 * @return {Promise} Promise representing the HTTP POST of a comment.
 */
function postCommentWithGif (gif) {
  console.log('Posting comment with gif...')
  return axios.post(
    githubPrCommentsUri,
    {
      body: `![${gif.title}](${gif.images.original.webp})\n${commentFooter}`
    },
    {
      headers: githubApiHeaders
    }
  )
}

/**
 * @param {string} giphyTag the tag to use to search giphy
 * @return {Promise} Promise representing the posting of a comment with a gif for the given giphy tag.
 */
function postGiphyGifForTag (giphyTag) {
  return getGiphyGifForTag(giphyTag).then(postCommentWithGif)
}

/**
 * @return {Promise} Promise representing the addition of a comment to the Pull Request
 * of a gif dependent upon the aggregate status of checks run against a Pull Request.
 */
function scanChecksAndPostGif () {
  console.log('Scanning checks...')
  return deleteExistingComments()
    .then(() => fetchChecks())
    .then(getStatusOfChecks)
    .then(status => {
      switch (status) {
        case 'FAILURE':
          return postGiphyGifForTag('thumbs-down')
        case 'SUCCESS':
          return postGiphyGifForTag('thumbs-up')
        case 'IN_PROGRESS':
          return new Promise(resolve => setTimeout(resolve, 5000)).then(
            scanChecksAndPostGif
          )
      }
    })
}

if (
  !githubEvent ||
  (githubEvent.action !== 'synchronize' && githubEvent.action !== 'opened')
) {
  console.log(
    `GitHub event payload not found or Pull Request event does not have desired action. Action was ${
      githubEvent.action
    }.`
  )
  process.exit(NEUTRAL_ERROR_CODE)
}

console.log(
  `Running ${githubAction} for Pull Request #${
    githubEvent.number
  } triggered by action ${githubEvent.action}.`
)

scanChecksAndPostGif()
  .then(() => process.exit(0))
  .catch(error => {
    console.log(error)
    process.exit(1)
  })

setTimeout(() => {
  console.log('Reached maximum timeout.')
  process.exit(1)
}, 300000)
